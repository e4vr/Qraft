"""Full Access migration preserves existing rights and replaces the live catalog."""
import json
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class FullAccessMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        paths = sorted((ROOT/'drizzle').glob('*.sql'))
        for path in paths[:-1]: self.db.executescript(path.read_text(encoding='utf-8'))
        now = '2026-09-30T00:00:00Z'
        self.expiry = '2027-04-01T00:00:00Z'
        for plan in ['free','lite','pro','unlimited']:
            payload=json.dumps(dict(uid=plan,tier=plan,status='approved',role='student',displayName=plan))
            self.db.execute('INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(plan,plan+'@test.invalid','hash','salt',payload,now,now))
            if plan=='free': continue
            self.db.execute("INSERT INTO subscriptions(user_id,status,starts_at,expires_at,method,paid,updated_at,plan) VALUES(?,'active',?,?,'manual',1234,?,?)",(plan,now,self.expiry,now,plan))
            self.db.execute("INSERT INTO reward_passes(id,user_id,plan,duration,duration_unit,status,created_at,expires_at,source,duration_days) VALUES(?,?,?,1,'month','active',?,?,'admin',45)",('gift-'+plan,plan,plan,now,self.expiry))
            self.db.execute('INSERT INTO account_plan_overrides VALUES(?,?,?,?,?,?)',(plan,plan,self.expiry,'preserve','free',now))
            self.db.execute('INSERT INTO admin_plan_entitlements(id,user_id,plan,reason,granted_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',('grant-'+plan,plan,plan,'preserve','free',now,self.expiry))
        self.db.execute("INSERT INTO discount_codes(id,code,kind,amount,updated_at) VALUES('code','SAVE','percent',20,?)",(now,))
        self.db.execute("INSERT INTO discount_codes(id,code,kind,amount,updated_at,allowed_plans) VALUES('monthly-code','MONTH','percent',20,?,'[\"lite\",\"pro\"]')",(now,))
        self.db.execute("INSERT INTO discount_codes(id,code,kind,amount,updated_at,allowed_plans) VALUES('quarterly-code','QUARTER','percent',20,?,'[\"unlimited\"]')",(now,))
        self.db.execute("INSERT INTO subscription_events(id,user_id,email,name,action,original,discount,final,status,created_at,detail,plan) VALUES('old-payment','pro','pro@test.invalid','pro','subscription_manually_activated',5000,0,5000,'success',?,'original payment','pro')",(now,))
        self.db.commit()
        self.db.executescript(paths[-1].read_text(encoding='utf-8'))
    def tearDown(self): self.db.close()
    def test_catalog_only_contains_new_periods(self):
        self.assertEqual(self.db.execute('SELECT plan,price_halalas FROM plan_prices ORDER BY plan').fetchall(), [('free',0),('full_monthly',10000),('full_quarterly',23000)])
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
        for table in ['subscriptions','subscription_events','reward_passes','admin_plan_entitlements','account_plan_overrides','plan_prices']:
            sql=self.db.execute('SELECT sql FROM sqlite_master WHERE name=?',(table,)).fetchone()[0]
            for retired in ["'lite'","'pro'","'unlimited'"]: self.assertNotIn(retired,sql)
    def test_accounts_and_existing_expirations_are_preserved(self):
        for old,new in [('free','free'),('lite','full_monthly'),('pro','full_monthly'),('unlimited','full_quarterly')]:
            row=self.db.execute('SELECT profile_json,password_hash FROM profiles WHERE uid=?',(old,)).fetchone()
            self.assertEqual(json.loads(row[0])['tier'],new)
            self.assertEqual(row[1],'hash')
            if old=='free': continue
            self.assertEqual(self.db.execute('SELECT plan,expires_at,paid FROM subscriptions WHERE user_id=?',(old,)).fetchone(),(new,self.expiry,1234))
            self.assertEqual(self.db.execute('SELECT plan,expires_at,duration_days FROM reward_passes WHERE user_id=?',(old,)).fetchone(),(new,self.expiry,45))
            for table in ['admin_plan_entitlements','account_plan_overrides']:
                self.assertEqual(self.db.execute(f'SELECT plan,expires_at FROM {table} WHERE user_id=?',(old,)).fetchone(),(new,self.expiry))
        self.assertEqual(self.db.execute('SELECT original,final,detail,plan FROM subscription_events WHERE id="old-payment"').fetchone(),(5000,5000,'original payment','full_monthly'))
    def test_old_plan_writes_are_rejected_and_new_discounts_work(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO plan_prices VALUES('pro',50,'now',5000,NULL)")
        self.assertEqual(json.loads(self.db.execute("SELECT allowed_plans FROM discount_codes WHERE id='code'").fetchone()[0]),['full_monthly','full_quarterly'])
        self.assertEqual(json.loads(self.db.execute("SELECT allowed_plans FROM discount_codes WHERE id='monthly-code'").fetchone()[0]),['full_monthly'])
        self.assertEqual(json.loads(self.db.execute("SELECT allowed_plans FROM discount_codes WHERE id='quarterly-code'").fetchone()[0]),['full_quarterly'])
        self.db.execute("UPDATE discount_codes SET amount=100 WHERE id='code'")
        self.db.execute("INSERT INTO subscription_events(id,user_id,email,name,code_id,code,action,original,discount,final,status,starts_at,expires_at,created_at,detail,plan) VALUES('new-payment','free','free@test.invalid','free','code','SAVE','discount_redeemed',23000,23000,0,'success','2026-09-30','2026-12-30','2026-09-30','new payment','full_quarterly')")
        self.assertEqual(self.db.execute("SELECT plan,expires_at FROM subscriptions WHERE user_id='free'").fetchone(),('full_quarterly','2026-12-30'))
        self.assertEqual(self.db.execute("SELECT uses FROM discount_codes WHERE id='code'").fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM question_registry').fetchone()[0],217)

if __name__=='__main__': unittest.main()
