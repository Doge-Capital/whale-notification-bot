const dotenv = require("dotenv");
dotenv.config();

const config = {
  mongodb: {
    url: process.env.DB_URI,
    databaseName: "test",
  },
  migrationsDir: "migrations",
  changelogCollectionName: "changelog",
  migrationFileExtension: ".ts",
  useFileHash: false,
  moduleSystem: "commonjs",
};

module.exports = config;
