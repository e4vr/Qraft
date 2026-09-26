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
            self.db.execute('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)', (uid,uid+'@example.test','unused','unused',profile,None,'2026-01-01','2026-01-01'))

    def tearDown(self):
        self.db.close()

    def code(self, **overrides):
        args = dict(id='code1',code='FREE',kind='percent',amount=100,enabled=1,starts_at=None,expires_at=None,max_uses=1,per_user=1,uses=0,updated_at='2026-09-05')
        args.update(overrides)
        self.db.execute('INSERT INTO discount_codes VALUES('+','.join('?'*len(args))+')', list(args.values()))

    def redeem(self, user='one', event='event1', final=0, discount=1500, admin=None):
        self.db.execute('INSERT INTO subscription_events(id,user_id,email,name,admin_id,code_id,code,action,original,discount,final,status,starts_at,expires_at,created_at,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (event,user,user+'@example.test',user,admin,'code1','FREE','discount_redeemed',1500,discount,final,'success','2026-09-05T00:00:00Z','2027-09-05T00:00:00Z','2026-09-05T00:00:00Z','test'))

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
        self.assertEqual(self.db.execute("SELECT json_extract(profile_json,'$.tier') FROM profiles WHERE uid='one'").fetchone()[0],'pro')
        self.assertEqual(self.db.execute("SELECT expires_at FROM subscriptions WHERE user_id='one'").fetchone()[0],'2027-09-05T00:00:00Z')
        with self.assertRaises(sqlite3.IntegrityError): self.redeem('two','event2')
        self.assertEqual(self.db.execute('SELECT uses FROM discount_codes').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM subscription_events').fetchone()[0],1)
        self.assertEqual(self.db.execute("SELECT json_extract(profile_json,'$.tier') FROM profiles WHERE uid='two'").fetchone()[0],'lite')

    def test_per_user_limit_survives_cancellation(self):
        self.code(max_uses=None)
        self.redeem()
        self.db.execute("UPDATE profiles SET profile_json=json_set(profile_json,'$.tier','lite') WHERE uid='one'")
        with self.assertRaises(sqlite3.IntegrityError): self.redeem(event='event2')

    def test_expired_disabled_and_future_codes_reject(self):
        for values in [dict(expires_at='2026-09-04'),dict(starts_at='2026-09-06'),dict(enabled=0)]:
            self.db.execute('DELETE FROM discount_codes')
            self.code(**values)
            with self.assertRaises(sqlite3.IntegrityError): self.redeem()

    def test_server_price_change_invalidates_stale_quote(self):
        self.code()
        self.db.execute('UPDATE subscription_settings SET price=2000')
        with self.assertRaises(sqlite3.IntegrityError): self.redeem()

    def test_fixed_discount_capped_and_positive_requires_admin(self):
        self.code(kind='fixed',amount=500,max_uses=None)
        with self.assertRaises(sqlite3.IntegrityError): self.redeem(final=1000,discount=500)
        self.redeem(final=1000,discount=500,admin='admin')
        self.assertEqual(self.db.execute("SELECT paid FROM subscriptions WHERE user_id='one'").fetchone()[0],1000)

    def test_lite_test_cap_survives_deleted_history(self):
        for i in range(3): self.db.execute('INSERT INTO test_registry VALUES(?,?,?)',('one',str(i),30))
        self.db.execute("INSERT OR IGNORE INTO test_registry VALUES('one','0',30)")
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("INSERT INTO test_registry VALUES('one','4',10)")
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("INSERT INTO test_registry VALUES('two','1',31)")

    def test_hard_delete_unlinks_ticket_and_all_personal_state(self):
        internal,uuid,number=self.db.execute('SELECT id,uuid,question_id FROM question_registry LIMIT 1').fetchone()
        self.db.execute("INSERT INTO tickets VALUES('ticket','one','Problem','open',?,1,'2026-09-05','2026-09-05')",(uuid,))
        self.db.execute("INSERT INTO ticket_messages VALUES('msg','ticket','one','Keep this description',NULL,'2026-09-05')")
        state=dict(version=1,progress={internal:{'note':'content'}},questionOverrides={internal:{'stem':'content'}},customQuestions=[{'id':internal}],reports=[{'id':'report','questionId':internal,'message':'Keep report'}],revisions=[{'id':'revision','questionId':internal}],tests=[{'id':'t','questionIds':[internal,'other'],'answers':{internal:1},'revealed':[internal],'graded':[internal],'currentIndex':1}])
        self.db.execute("INSERT INTO app_states VALUES('one',?,'2026-09-05')",(json.dumps(state),))
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


if __name__ == '__main__': unittest.main()
