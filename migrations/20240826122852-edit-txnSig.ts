module.exports = {
  async up(db, client) {
    await db.collection('txnsignatures').updateMany({}, {$set: {status: 'pending'}});
  },

  async down(db, client) {
    await db.collection('txnsignatures').updateMany({}, {$unset: {status: ''}});
  }
};
