import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

void test('discount binding migration preserves existing promotions, usage and transaction history', () => {
  const result = JSON.parse(
    execFileSync(
      'python',
      [
        '-c',
        `
import sqlite3,json,pathlib
db=sqlite3.connect(':memory:')
for f in sorted(pathlib.Path('drizzle').glob('*.sql')):
 if f.name.startswith('0036'): break
 db.executescript(f.read_text(encoding='utf-8'))
db.execute("INSERT INTO discount_codes(id,code,kind,amount,enabled,uses,max_uses,per_user,updated_at) VALUES('old','EXISTING','percent',25,1,3,10,1,'2026-10-01')")
db.execute("INSERT INTO subscription_events(id,user_id,email,name,code_id,code,action,original,discount,final,status,created_at,detail) VALUES('old-event','old-member','old@example.test','Member','old','EXISTING','test',10000,2500,7500,'success','2026-10-01','Synthetic history')")
before=db.execute('SELECT * FROM discount_codes').fetchone()
events=db.execute('SELECT * FROM subscription_events').fetchall()
db.executescript(pathlib.Path('drizzle/0036_account_bound_discounts.sql').read_text(encoding='utf-8'))
after=db.execute('SELECT * FROM discount_codes').fetchone()
print(json.dumps({'preserved':before==after[:-1],'unrestricted':after[-1] is None,'history':events==db.execute('SELECT * FROM subscription_events').fetchall(),'trigger':db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name='redeem_discount_account'").fetchone()[0]}))
`,
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.deepEqual(result, {
    preserved: true,
    unrestricted: true,
    history: true,
    trigger: 1,
  });
});
