











const T = {
   
  Settings: { pk: 'key', cols: { key: 'VARCHAR(60)', value: 'TEXT' } },

   
  Users: {  
    cols: { id: 'VARCHAR(20)', committee: 'VARCHAR(80)', type: 'VARCHAR(60)', incharge: 'VARCHAR(80)', phone: 'VARCHAR(15)', salt: 'VARCHAR(64)', hash: 'VARCHAR(200)', status: 'VARCHAR(12)', createdAt: 'VARCHAR(30)' },
    unique: ['committee'], index: [['status']] },
  Admins: {
    cols: { id: 'VARCHAR(20)', name: 'VARCHAR(80)', phone: 'VARCHAR(15)', username: 'VARCHAR(40)', salt: 'VARCHAR(64)', hash: 'VARCHAR(200)', status: 'VARCHAR(12)', isSuper: 'TINYINT(1)', createdAt: 'VARCHAR(30)' },
    unique: ['username'] },
  DeletedAccounts: {  
    cols: { id: 'VARCHAR(20)', role: 'VARCHAR(10)', name: 'VARCHAR(80)', username: 'VARCHAR(40)', type: 'VARCHAR(60)', incharge: 'VARCHAR(80)', phone: 'VARCHAR(15)', createdAt: 'VARCHAR(30)', deletedAt: 'VARCHAR(30)', bookingsCancelled: 'INT' },
    index: [['role']] },

   
  Venues: { cols: { id: 'VARCHAR(20)', name: 'VARCHAR(100)', capacity: 'INT', location: 'VARCHAR(150)', photo: 'VARCHAR(255)', openTime: 'VARCHAR(5)', closeTime: 'VARCHAR(5)', resources: 'TEXT' } },
  Closures: { cols: { id: 'VARCHAR(20)', venueId: 'VARCHAR(20)', date: 'VARCHAR(10)', fullDay: 'TINYINT(1)', ranges: 'TEXT' }, index: [['venueId', 'date']] },

   
  Bookings: { cols: {
    id: 'VARCHAR(20)',                 
    venueId: 'VARCHAR(20)', venueName: 'VARCHAR(100)', venueLocation: 'VARCHAR(150)',           
    userId: 'VARCHAR(20)',             
    bookedByRole: 'VARCHAR(10)',       
    organizerKind: 'VARCHAR(10)',      
    bookedByName: 'VARCHAR(80)',       
    inchargeName: 'VARCHAR(80)',       
    inchargePhone: 'VARCHAR(15)',
    adminId: 'VARCHAR(20)', adminName: 'VARCHAR(80)', adminUsername: 'VARCHAR(40)',  
    title: 'VARCHAR(120)', category: 'VARCHAR(60)', desc: 'VARCHAR(500)',
    date: 'VARCHAR(10)', start: 'VARCHAR(5)', end: 'VARCHAR(5)', attendees: 'INT', resources: 'TEXT',
    status: 'VARCHAR(12)',             
    reasonCode: 'VARCHAR(30)',         
    reason: 'VARCHAR(400)',            
    cancelledBy: 'VARCHAR(80)',        
    createdAt: 'VARCHAR(30)', approvedAt: 'VARCHAR(30)', rejectedAt: 'VARCHAR(30)', cancelledAt: 'VARCHAR(30)'
  }, index: [['venueId', 'date'], ['userId'], ['status'], ['date']] },

   
  Chats: { cols: { id: 'VARCHAR(20)', fromId: 'VARCHAR(20)', toId: 'VARCHAR(20)', text: 'TEXT', timestamp: 'VARCHAR(30)', read: 'TINYINT(1)', deleted: 'TINYINT(1)', deletedAt: 'VARCHAR(30)' }, index: [['fromId'], ['toId']] },
  Notifications: { cols: { id: 'VARCHAR(20)', userId: 'VARCHAR(20)', text: 'TEXT', date: 'VARCHAR(30)', read: 'TINYINT(1)', type: 'VARCHAR(30)', reqAdminId: 'VARCHAR(20)', resolved: 'TINYINT(1)', refId: 'VARCHAR(20)' }, index: [['userId']] },
  Logs: { cols: { id: 'VARCHAR(20)', date: 'VARCHAR(30)', action: 'VARCHAR(400)', by: 'VARCHAR(100)' } },

   
  Sessions: { pk: 'token', cols: { token: 'VARCHAR(128)', userId: 'VARCHAR(20)', role: 'VARCHAR(10)', expires: 'BIGINT' }, index: [['userId']] },
  Verifications: {  
    cols: { id: 'VARCHAR(60)', userId: 'VARCHAR(20)', role: 'VARCHAR(10)', purpose: 'VARCHAR(20)', code: 'VARCHAR(10)', expires: 'BIGINT', tries: 'INT' } }
};
 
const BACKUP_TABLES = Object.keys(T).filter(t => !['Sessions', 'Verifications'].includes(t));
const SCHEMA_VERSION = 2;

const q = n => '`' + n + '`';
function createSql(name) {
  const t = T[name], pk = t.pk || 'id';
  const cols = Object.entries(t.cols).map(([c, ty]) => `${q(c)} ${ty}${c === pk ? ' NOT NULL' : ' NULL'}`);
  cols.push('`seq` BIGINT NOT NULL AUTO_INCREMENT', `PRIMARY KEY (${q(pk)})`, 'UNIQUE KEY `seq` (`seq`)');
  (t.unique || []).forEach(c => cols.push(`UNIQUE KEY ${q('u_' + c)} (${q(c)})`));
  (t.index || []).forEach(ix => cols.push(`KEY ${q('i_' + ix.join('_'))} (${ix.map(q).join(',')})`));
  return `CREATE TABLE IF NOT EXISTS ${q(name)} (\n  ${cols.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}
module.exports = { TABLES: T, BACKUP_TABLES, SCHEMA_VERSION, createSql };
