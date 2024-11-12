const { defineConfig } = require('cypress');
const { google } = require('googleapis');
const path = require('path');
const sqlite3 = require('sqlite3').verbose(); // SQLite package
const moment = require('moment-timezone'); // For handling timezones

// Use an environment variable for the service account key file path
const SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_CREDENTIALS_FILE_PATH || 'cypress/fixtures/credentials.json';

async function authorize() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth.getClient();
}

async function writeGoogleSheet({ spreadsheetId, range, values }) {
  const authClient = await authorize();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: range,
    valueInputOption: 'RAW',
    requestBody: {
      values: values,
    },
  });

  return 'Update successful';
}

// New function to copy updated data from Google Sheets to the SQLite database
async function dumpSheetDataToDatabase(sheetData) {
  const dbPath = path.resolve('analytic_data.sqlite');
  const db = new sqlite3.Database(dbPath);

  db.serialize(() => {
    // Create the table if it doesn't exist with an auto-increment 'id' and 'analytic_id'
    db.run(`
      CREATE TABLE IF NOT EXISTS analytics_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Auto-incrementing primary key
        analytic_id TEXT NOT NULL,               -- The original ID from Google Sheets
        url TEXT,
        fieldname TEXT,
        value TEXT,
        action TEXT,
        status TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Prepare an insert statement
    const stmt = db.prepare(`
      INSERT INTO analytics_data (analytic_id, url, fieldname, value, action, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Insert data from the Google Sheet
    sheetData.slice(1).forEach(row => {
      const analyticId = row[0];    // The ID from Google Sheets
      const url = row[1];
      const fieldname = row[2];
      const value = row[3];
      const action = row[4];
      const status = row[5];
      const createdAt = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'); // Timestamp in IST

      stmt.run(analyticId, url, fieldname, value, action, status, createdAt);
    });

    stmt.finalize();
  });

  db.close();
  return 'Data from Google Sheets dumped into the database successfully';
}

  

module.exports = defineConfig({
  e2e: {
    baseUrl: 'https://www.credello.com',
    setupNodeEvents(on, config) {
      on('task', {
        async readGoogleSheet({ range }) {
          const authClient = await authorize();
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const spreadsheetId = '1_dfBa_dLSQDm4QqHUMIvrN9adNL6ga-lUGp4xFDNaqQ'; // Replace with your actual sheet ID
          const sheetRange = range || 'Sheet1!A:F'; // Default range if none is passed

          const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: sheetRange,
          });

          const rows = res.data.values;
          if (!rows || rows.length === 0) {
            console.log('No data found.');
            return [];
          }

          return rows; // Return the data fetched from the sheet
        },
        async writeGoogleSheet({ range, values }) {
          const spreadsheetId = '1_dfBa_dLSQDm4QqHUMIvrN9adNL6ga-lUGp4xFDNaqQ'; // Replace with your actual sheet ID
          return await writeGoogleSheet({ spreadsheetId, range, values });
        },
        async dumpSheetDataToDatabase({ sheetData }) {
          return await dumpSheetDataToDatabase(sheetData);
        }
      });
    },
  },
});
