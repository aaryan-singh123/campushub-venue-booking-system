 
const fs = require('fs'), path = require('path');
const { TABLES, createSql, SCHEMA_VERSION } = require('../server/schema');
let sql = `-- CampusHub database (schema version ${SCHEMA_VERSION}). Generated from server/schema.js - do not edit by hand.\n-- The website also creates these tables by itself on first start; use this file only if you want to create them manually.\n\nCREATE DATABASE IF NOT EXISTS \`campushub\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nUSE \`campushub\`;\n\n`;
for (const t of Object.keys(TABLES)) sql += createSql(t).replace('IF NOT EXISTS ', 'IF NOT EXISTS ') + ';\n\n';
fs.writeFileSync(path.join(__dirname, '..', 'database', 'campushub.sql'), sql);
console.log('database/campushub.sql written');
