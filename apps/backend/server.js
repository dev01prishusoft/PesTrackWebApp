const app = require('./src/app');
require('dotenv').config();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`PesTrack backend listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
