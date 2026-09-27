"""Behavioral checks for migrations, atomic discount redemption and identity reuse.

Runs against an in-memory database; never opens the application's database.
"""
import json
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PlatformDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for path in sorted((ROOT / 'drizzle').glob('*.sql')):
            self.db.executescript(path.read_text(encoding='utf-8'))
        for uid in ['one', 'two', 'admin']:
            profile = json.dumps(dict(uid=uid, email=uid+'@example.test', displayName=uid, tier='lite', role='super_admin' if uid=='admin' else 'student', status='approved', platformRoles=[]))
            self.db.execute(
                'INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,totp_secret,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                (uid,uid+'@example.test','unused','unused',profile,None,'2026-01-01','2026-01-01'),
            )

    def tearDown(self):
        self.db.close()

    def code(self, **overrides):
        args = dict(id='code1',code='FREE',kind='percent',amount=100,enabled=1,starts_at=None,expires_at=None,max_uses=1,per_user=1,uses=0,updated_at='2026-09-05')
        args.update(overrides)
        self.db.execute(
            'INSERT INTO discount_codes(id,code,kind,amount,enabled,starts_at,expires_at,max_uses,per_user,uses,updated_at) VALUES('+','.join('?'*len(args))+')',
            list(args.values()),
        )

    def redeem(self, user='one', event='event1', final=0, discount=5000, admin=None):
        self.db.execute('INSERT INTO subscription_events(id,user_id,email,name,admin_id,code_id,code,action,original,discount,final,status,starts_at,expires_at,created_at,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (event,user,user+'@example.test',user,admin,'code1','FREE','discount_redeemed',5000,discount,final,'success','2026-09-05T00:00:00Z','2027-09-05T00:00:00Z','2026-09-05T00:00:00Z','test'))

    def test_seed_preserved(self):
        self.assertEqual(self.db.execute('SELECT count(*) FROM question_registry').fetchone()[0],217)
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
        for question in json.loads((ROOT/'data/questions.json').read_text(encoding='utf-8')):
            stored=json.loads(self.db.execute("SELECT payload FROM records WHERE type='sharedQuestions' AND id=?",(question['id'],)).fetchone()[0])
            self.assertEqual(stored['stem'],question['stem'])
            self.assertEqual(stored['options'],question['options'])

    def test_redemption_is_atomic_and_cannot_exceed_cap(self):
        self.code()
        self.redeem()
        self.assertEqual(self.db.execute("SELECT plan FROM subscriptions WHERE user_id='one'").fetchone()[0],'pro')
        self.assertEqual(self.db.execute("SELECT expires_at FROM subscriptions WHERE user_id='one'").fetchone()[0],'2027-09-05T00:00:00Z')
        with self.assertRaises(sqlite3.IntegrityError): self.redeem('two','event2')
        self.assertEqual(self.db.execute('SELECT uses FROM discount_codes').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM subscription_events').fetchone()[0],1)
        self.assertIsNone(self.db.execute("SELECT plan FROM subscriptions WHERE user_id='two'").fetchone())

    def test_per_user_limit_survives_cancellation(self):
        self.code(max_uses=None)
        self.redeem()
        self.db.execute("UPDATE subscriptions SET status='cancelled' WHERE user_id='one'")
        with self.assertRaises(sqlite3.IntegrityError): self.redeem(event='event2')

    def test_expired_disabled_and_future_codes_reject(self):
        for values in [dict(expires_at='2026-09-04'),dict(starts_at='2026-09-06'),dict(enabled=0)]:
            self.db.execute('DELETE FROM discount_codes')
            self.code(**values)
            with self.assertRaises(sqlite3.IntegrityError): self.redeem()

    def test_server_price_change_invalidates_stale_quote(self):
        self.code()
        self.db.execute("UPDATE plan_prices SET price_sar_year=20 WHERE plan='pro'")
        with self.assertRaises(sqlite3.IntegrityError): self.redeem()

    def test_fixed_discount_uses_current_plan_price(self):
        self.code(kind='fixed',amount=500,max_uses=None)
        self.redeem(final=4500,discount=500)
        self.assertEqual(self.db.execute("SELECT paid FROM subscriptions WHERE user_id='one'").fetchone()[0],4500)

    def test_registry_keeps_idempotent_test_identity(self):
        for i in range(3):
            self.db.execute(
                'INSERT INTO test_registry(user_id,test_id,question_count) VALUES(?,?,?)',
                ('one',str(i),30),
            )
        self.db.execute("INSERT OR IGNORE INTO test_registry(user_id,test_id,question_count) VALUES('one','0',30)")
        self.db.execute("INSERT INTO test_registry(user_id,test_id,question_count) VALUES('one','4',10)")
        self.db.execute("INSERT INTO test_registry(user_id,test_id,question_count) VALUES('two','1',31)")
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM test_registry WHERE user_id='one'").fetchone()[0],
            4,
        )

    def test_hard_delete_unlinks_ticket_and_all_personal_state(self):
        internal,uuid,number=self.db.execute('SELECT id,uuid,question_id FROM question_registry LIMIT 1').fetchone()
        self.db.execute("INSERT INTO tickets VALUES('ticket','one','Problem','open',?,1,'2026-09-05','2026-09-05')",(uuid,))
        self.db.execute("INSERT INTO ticket_messages VALUES('msg','ticket','one','Keep this description',NULL,'2026-09-05')")
        state=dict(version=1,progress={internal:{'note':'content'}},questionOverrides={internal:{'stem':'content'}},customQuestions=[{'id':internal}],reports=[{'id':'report','questionId':internal,'message':'Keep report'}],revisions=[{'id':'revision','questionId':internal}],tests=[{'id':'t','questionIds':[internal,'other'],'answers':{internal:1},'revealed':[internal],'graded':[internal],'currentIndex':1}])
        self.db.execute(
            "INSERT INTO app_states(user_id,payload,updated_at) VALUES('one',?,'2026-09-05')",
            (json.dumps(state),),
        )
        self.db.execute("DELETE FROM records WHERE type='sharedQuestions' AND id=?",(internal,))
        ticket=self.db.execute('SELECT question_uuid,question_linked FROM tickets').fetchone()
        self.assertEqual(ticket,(None,1))
        self.assertEqual(self.db.execute('SELECT body FROM ticket_messages').fetchone()[0],'Keep this description')
        clean=json.loads(self.db.execute('SELECT payload FROM app_states').fetchone()[0])
        self.assertEqual(clean['reports'][0]['questionId'],'#deleted')
        self.assertEqual(clean['progress'],{})
        self.assertEqual(clean['tests'][0]['questionIds'],['other'])
        payload=json.dumps(dict(id='new-id',questionId=number,qbankId='smle-gs'))
        self.db.execute("INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES('sharedQuestions','new-id','smle-gs',?,'2026-09-05')",(payload,))
        self.assertIsNone(self.db.execute('SELECT question_uuid FROM tickets').fetchone()[0])
        self.assertNotEqual(self.db.execute("SELECT uuid FROM question_registry WHERE id='new-id'").fetchone()[0],uuid)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES('sharedQuestions',?,'smle-gs',?,'2026-09-05')",(internal,json.dumps(dict(id=internal,questionId='88888'))))

    def test_existing_question_id_is_immutable(self):
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("UPDATE records SET payload=json_set(payload,'$.questionId','88888') WHERE type='sharedQuestions' AND id=(SELECT id FROM question_registry LIMIT 1)")


class ReleaseUpgradeTests(unittest.TestCase):
    def test_rc1_import_history_survives_rc2_migrations_and_repeat_imports(self):
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        db.execute('PRAGMA foreign_keys=ON')
        migrations = sorted((ROOT / 'drizzle').glob('*.sql'))
        for path in migrations:
            if int(path.name[:4]) <= 20:
                db.executescript(path.read_text(encoding='utf-8'))
        db.execute("INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,created_at,updated_at) VALUES('upgrade','upgrade@staging.qraft.invalid','unused','unused','{}','2026-09-27','2026-09-27')")
        insert = "INSERT INTO imported_files(id,user_id,file_name,normalized_name,file_hash,batch_id,source_file,successful_count,skipped_count,report_json,uploaded_at) VALUES(?,'upgrade','fixture.json','fixture.json','same-hash',?,'synthetic',2,1,'[]','2026-09-27')"
        db.execute(insert, ('old-import', 'old-batch'))
        before = db.execute('SELECT * FROM imported_files').fetchone()
        for path in migrations:
            if int(path.name[:4]) > 20:
                db.executescript(path.read_text(encoding='utf-8'))
        original_columns = 'id,user_id,file_name,normalized_name,file_hash,batch_id,source_file,successful_count,skipped_count,report_json,uploaded_at,daily_limit,pending_limit'
        self.assertEqual(db.execute(f"SELECT {original_columns} FROM imported_files WHERE id='old-import'").fetchone(), before)
        self.assertEqual(db.execute("SELECT status,total_count,successful_count,invalid_count,legacy FROM json_import_runs WHERE id='legacy-old-import'").fetchone(), ('partial',3,2,1,1))
        db.execute(insert, ('repeat-import', 'new-batch'))
        self.assertEqual(db.execute('SELECT count(*) FROM imported_files').fetchone()[0], 2)
        self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])


class ParticipantPrivacyUpgradeTests(unittest.TestCase):
    def test_upgrade_removes_deleted_identities_and_preserves_active_results(self):
        db = sqlite3.connect(':memory:')
        db.execute('PRAGMA foreign_keys=ON')
        for path in sorted((ROOT / 'drizzle').glob('*.sql')):
            if int(path.name[:4]) < 24:
                db.executescript(path.read_text(encoding='utf-8'))
        db.execute("INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,created_at,updated_at) VALUES('owner','owner@test','unused','unused','{}','now','now')")
        db.execute("INSERT INTO preformed_tests(id,code,owner_id,owner_name,title,description,visibility,status,version,questions_json,settings_json,created_at,updated_at) VALUES('test','QF-TEST00','owner','Owner','Fixture','','public','published',1,'[]','{}','now','now')")
        for uid in ['owner', 'already-deleted']:
            db.execute('INSERT INTO preformed_attempt_tokens(token_hash,test_id,version,user_id,issued_at,expires_at) VALUES(?,?,1,?,?,?)', (uid, 'test', uid, 'now', 'later'))
            db.execute('INSERT INTO preformed_leaderboard(id,test_id,version,participant_user_id,participant_key,participant_name,guest,score,question_count,duration_seconds,attempt_number,submitted_at) VALUES(?,?,1,?,?,?,0,1,1,10,1,?)', (uid, 'test', uid if uid == 'owner' else None, 'user:'+uid, uid, 'now'))
            db.execute('INSERT INTO preformed_submission_receipts(submission_id,test_id,attempt_token_hash,leaderboard,result_json,created_at) VALUES(?,?,?,1,?,?)', (uid, 'test', uid, '{}', 'now'))
        db.executescript((ROOT / 'drizzle' / '0024_preformed_participant_privacy.sql').read_text(encoding='utf-8'))
        self.assertEqual(db.execute('SELECT participant_key FROM preformed_leaderboard').fetchall(), [('user:owner',)])
        self.assertEqual(db.execute('SELECT user_id,submitted_at FROM preformed_attempt_tokens').fetchall(), [('owner', 'now')])
        self.assertEqual(db.execute("SELECT user_id FROM preformed_submission_receipts WHERE submission_id='owner'").fetchone(), ('owner',))
        self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
        db.close()


if __name__ == '__main__': unittest.main()
