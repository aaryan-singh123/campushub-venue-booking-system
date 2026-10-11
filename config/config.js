
module.exports = {
   
  mysql: {
    host: 'localhost',
    port: 3306,
    user: '',
    password: '',
    database: 'campushub'
},

  uploadDir: process.env.UPLOAD_DIR || '',

  port: 3000,
  timezone: 'Asia/Kolkata',    
  sessionHours: 12,            
  refreshSeconds: 30,          

  seed: {
    categories: ['Seminar', 'Workshop', 'Meeting', 'Conference'],
    committeeTypes: ['Department', 'Committee', 'External']
  }
};
