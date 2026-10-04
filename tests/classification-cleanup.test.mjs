import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['features/qbanks/server/classification-cleanup.ts', 'features/qbanks/server/publication-classification.ts', 'features/progress/domain/qbank-classification.ts'], bundle: true, write: false, outdir: 'unused', format: 'esm', platform: 'node' });
const modules = await Promise.all(built.outputFiles.map(output => import(`data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`)));
const { classificationCleanupStatements } = modules.find(module => module.classificationCleanupStatements);
const { groupQuestionsByQBankClassification, occupiedQBankClassification } = modules.find(module => module.groupQuestionsByQBankClassification);
const { publicationClassificationResolver } = modules.find(module => module.publicationClassificationResolver);
const now = '2026-10-04T00:00:00.000Z';
const capture = { prepare(sql) { return { bind(...params) { return { sql, params }; } }; } };
const cleanup = classificationCleanupStatements(capture, ['bank'], now);

void test('Progress and bank classification lists disappear immediately after the last question leaves', () => {
  const specialties = [{ id: 's', name: 'Surgery', order: 0 }, { id: 'empty', name: 'Empty', order: 1 }];
  const topics = [{ id: 't', specialtyId: 's', name: 'Used', order: 0 }, { id: 'unused', specialtyId: 's', name: 'Unused', order: 1 }];
  const questions = [{ id: 'q', specialtyId: 's', topicId: 't', specialty: 'Surgery', topic: 'Used' }];
  assert.deepEqual(occupiedQBankClassification(questions, specialties, topics), { specialties: [specialties[0]], topics: [topics[0]] });
  assert.deepEqual(groupQuestionsByQBankClassification([], specialties, topics), []);
  assert.deepEqual(occupiedQBankClassification([], specialties, topics), { specialties: [], topics: [] });
});

void test('atomic cleanup preserves live and legacy classifications, proposals, other banks and rollback', async () => {
  const migration = await readFile('drizzle/0033_remove_empty_classifications.sql', 'utf8');
  const script = String.raw`
import sqlite3,json,sys
data=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.executescript('''CREATE TABLE records(type TEXT,id TEXT,qbank_id TEXT,owner_id TEXT,payload TEXT,updated_at TEXT,UNIQUE(type,id));
CREATE INDEX bank_type ON records(qbank_id,type);
CREATE TABLE qbank_classification_revisions(qbank_id TEXT PRIMARY KEY,revision INTEGER,updated_at TEXT);
CREATE TRIGGER revision_guard BEFORE UPDATE ON qbank_classification_revisions WHEN NEW.revision!=OLD.revision+1 BEGIN SELECT RAISE(ABORT,'revision'); END;
CREATE TABLE collaboration_changes(collection TEXT,record_id TEXT);
CREATE TRIGGER journal_delete AFTER DELETE ON records BEGIN INSERT INTO collaboration_changes VALUES(OLD.type,OLD.id); END;''')
def put(kind,id,bank='bank',**fields):
 fields.update(id=id,qbankId=bank)
 db.execute('INSERT INTO records VALUES(?,?,?,NULL,?,?)',(kind,id,bank,json.dumps(fields),data['now']))
def rows(bank='bank'):
 return set(db.execute("SELECT type,id FROM records WHERE qbank_id=? AND type IN ('qbankTopics','qbankSpecialties')",(bank,)))
def cleanup():
 for statement in data['cleanup']: db.execute(statement['sql'],statement['params'])
put('qbankSpecialties','s',name='Surgery',order=9)
put('qbankTopics','t',name='Used',specialtyId='s',order=7)
put('qbankSpecialties','unused-s',name='Empty')
put('qbankTopics','unused-t',name='Empty',specialtyId='s')
put('sharedQuestions','q1',specialtyId='s',topicId='t',specialty='Surgery',topic='Used')
put('sharedQuestions','q2',specialtyId='s',topicId='t',specialty='Surgery',topic='Used')
put('qbankSpecialties','legacy-s',name='Legacy')
put('qbankTopics','legacy-t',name='Legacy topic',specialtyId='legacy-s')
put('sharedQuestions','legacy-q',specialty='  legacy ',topic=' Legacy\t  topic ')
put('qbankSpecialties','foreign-s',bank='other',name='Empty')
put('questionProposals','pending',payload={'specialtyId':'pending-s','topicId':'pending-t','specialty':'Pending','topic':'Pending'},status='pending')
db.commit()
with db: cleanup()
assert rows()=={('qbankSpecialties','s'),('qbankTopics','t'),('qbankSpecialties','legacy-s'),('qbankTopics','legacy-t')}
assert json.loads(db.execute("SELECT payload FROM records WHERE id='s'").fetchone()[0])['order']==9
revision=db.execute('SELECT revision FROM qbank_classification_revisions').fetchone()[0]
with db: cleanup()
assert db.execute('SELECT revision FROM qbank_classification_revisions').fetchone()[0]==revision
with db:
 db.execute("DELETE FROM records WHERE id='q1'")
 cleanup()
assert ('qbankTopics','t') in rows()
with db:
 db.execute("DELETE FROM records WHERE id='q2'")
 cleanup()
assert ('qbankTopics','t') not in rows() and ('qbankSpecialties','s') not in rows()
assert rows('other')=={('qbankSpecialties','foreign-s')}
assert db.execute("SELECT payload FROM records WHERE id='pending'").fetchone() is not None
assert ('qbankTopics','t') in set(db.execute('SELECT collection,record_id FROM collaboration_changes'))
with db:
 put('sharedQuestions','published',specialtyId='pending-s',topicId='pending-t',specialty='Pending',topic='Pending')
 cleanup()
assert ('qbankTopics','pending-t') in rows() and ('qbankSpecialties','pending-s') in rows()
before=rows()
try:
 with db:
  db.execute("DELETE FROM records WHERE id='published'")
  cleanup()
  db.execute('SELECT nonexistent_column FROM records')
except sqlite3.OperationalError: pass
assert rows()==before and db.execute("SELECT id FROM records WHERE id='published'").fetchone()
# Migration cleans pre-existing empty rows across banks and keeps occupied ones.
with db: db.executescript(data['migration'])
assert rows('other')==set() and rows()==before
print(json.dumps({'ok':True}))
`;
  const result = spawnSync('python', ['-c', script], { input: JSON.stringify({ cleanup, migration, now }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

void test('publication reuses the same classification within a batch and isolates equal names in other banks', async () => {
  const db = { prepare() { return { bind() { return { async all() { return { results: [] }; } }; } }; } };
  const classify = await publicationClassificationResolver(db, ['one', 'two']);
  const first = classify({ qbankId: 'one', specialtyId: 's1', topicId: 't1', specialty: 'Surgery', topic: 'Trauma' });
  const second = classify({ qbankId: 'one', specialtyId: 's2', topicId: 't2', specialty: ' surgery ', topic: 'TRAUMA' });
  const other = classify({ qbankId: 'two', specialtyId: 's3', topicId: 't3', specialty: 'Surgery', topic: 'Trauma' });
  assert.equal(second.specialtyId, first.specialtyId);
  assert.equal(second.topicId, first.topicId);
  assert.equal(other.specialtyId, 's3');
  assert.equal(other.topicId, 't3');
});
