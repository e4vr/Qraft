"""Compare a declarative schema with SQL migrations in two disposable databases."""
import json
import pathlib
import re
import sqlite3
import sys


def normalize_sql(value):
    if value is None:
        return None
    parts = re.split(r"('(?:''|[^'])*')", value)
    for index in range(0, len(parts), 2):
        part = re.sub(r'[`"]', '', parts[index])
        part = re.sub(r'\b[a-z_]+\.', '', part)
        parts[index] = re.sub(r'\s+', '', part).lower()
    return ''.join(parts)


def columns(db, name):
    def default(value):
        return {'false': '0', 'true': '1'}.get(value, value)
    # Drizzle marks all primary-key columns NOT NULL; older SQLite migrations
    # omit that spelling. Preserve the SQL history instead of rebuilding tables.
    return {row[1]: (row[2].upper(), bool(row[3] or row[5]), default(row[4]), row[5])
            for row in db.execute(f'PRAGMA table_info("{name}")')}


def foreign_keys(db, name):
    return sorted(tuple(row[2:]) for row in db.execute(f'PRAGMA foreign_key_list("{name}")'))


def indexes(db, name):
    result = []
    for row in db.execute(f'PRAGMA index_list("{name}")'):
        if row[3] == 'pk':
            continue
        terms = [(item[2], item[3], item[4]) for item in db.execute(f'PRAGMA index_xinfo("{row[1]}")') if item[5]]
        sql = db.execute('SELECT sql FROM sqlite_master WHERE type=? AND name=?', ('index', row[1])).fetchone()[0]
        where = re.split(r'\bWHERE\b', sql, flags=re.I)[1] if sql and row[4] else None
        expression = re.split(r'\bON\s+[^ (]+', sql, flags=re.I)[1] if sql and any(term[0] is None for term in terms) else None
        # UNIQUE constraints may have SQLite-generated names. Compare their
        # semantics; ordinary named indexes remain a runtime contract.
        key = None if row[2] else row[1]
        result.append((key, bool(row[2]), terms, normalize_sql(where), normalize_sql(expression)))
    return sorted({repr(item): item for item in result}.values(), key=repr)


def check_schema(statements):
    actual = sqlite3.connect(':memory:')
    declared = sqlite3.connect(':memory:')
    for migration in sorted(pathlib.Path('drizzle').glob('*.sql')):
        actual.executescript(migration.read_text(encoding='utf-8'))
    for statement in statements:
        declared.executescript(statement)
    excluded = {'import_question_search', *(f'import_question_search_{suffix}' for suffix in ['config', 'content', 'data', 'docsize', 'idx'])}
    tables = lambda db: {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    expected = tables(declared)
    errors = []
    if tables(actual) - excluded != expected:
        errors.append({'tables': {'sqlOnly': sorted(tables(actual) - excluded - expected), 'schemaOnly': sorted(expected - tables(actual))}})
    for name in sorted(expected & tables(actual)):
        for label, inspect in [('columns', columns), ('foreignKeys', foreign_keys), ('indexes', indexes)]:
            left, right = inspect(actual, name), inspect(declared, name)
            if left != right:
                errors.append({'table': name, 'kind': label, 'sql': left, 'schema': right})
    objects = json.loads(pathlib.Path('db/sql-managed-objects.json').read_text(encoding='utf-8'))
    triggers = {row[0] for row in actual.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
    if triggers != set(objects['triggers']):
        errors.append({'triggers': {'sql': sorted(triggers), 'documented': sorted(objects['triggers'])}})
    if not excluded <= tables(actual):
        errors.append({'missingSearchTables': sorted(excluded - tables(actual))})
    assert not actual.execute('PRAGMA foreign_key_check').fetchall()
    print(json.dumps({'ok': not errors, 'tables': len(expected), 'sqlManagedTriggers': len(triggers), 'errors': errors}, ensure_ascii=False))
    actual.close()
    declared.close()
    return not errors


if __name__ == '__main__':
    sys.exit(0 if check_schema(json.load(sys.stdin)) else 1)
