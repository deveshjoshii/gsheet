const { defineConfig } = require('cypress');
const { google } = require('googleapis');
const { Pool } = require('pg'); // PostgreSQL package
const moment = require('moment-timezone'); // For handling timezones
const fs = require('fs');
<<<<<<< HEAD

// Use the environment variable directly
=======
const path = require('path');
>>>>>>> dbfix


// Load database credentials from dbConfig.json
let dbConfig;
try {
  dbConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'dbConfig.json'), 'utf-8'));
} catch (err) {
  console.error('Error loading dbConfig.json:', err);
  throw new Error('Unable to load database configuration');
}

// PostgreSQL connection configuration
const pool = new Pool(dbConfig);

async function authorize() {
  const SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_CREDENTIALS_FILE_PATH;

  if (!SERVICE_ACCOUNT_KEY_PATH) {
    throw new Error('GOOGLE_CREDENTIALS_FILE_PATH is not set.');
  }

  // Read and parse the credentials file
  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_KEY_PATH, 'utf8'));
  } catch (error) {
    throw new Error('Failed to read or parse the service account key file: ' + error.message);
  }

  // Check if private_key and client_email are present and valid
  if (typeof credentials.private_key !== 'string' || typeof credentials.client_email !== 'string') {
    throw new Error('Invalid private_key or client_email format in the credentials file.');
  }

  // Create a new instance of GoogleAuth
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  console.log('private_key exists:', !!credentials.private_key);
  console.log('client_email exists:', !!credentials.client_email);

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

// New function to copy updated data from Google Sheets to the PostgreSQL database
async function dumpSheetDataToDatabase(sheetData) {
  try {
    // Create the table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_data (
        id SERIAL PRIMARY KEY,                 
        analytic_id VARCHAR(255) NOT NULL,     
        url TEXT,
        fieldname VARCHAR(255),
        value TEXT,
        action VARCHAR(255),
        status VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert data from the Google Sheet
    const insertQuery = `
      INSERT INTO analytics_data (analytic_id, url, fieldname, value, action, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    for (let i = 1; i < sheetData.length; i++) {
      const row = sheetData[i];
      const analyticId = row[0];
      const url = row[1];
      const fieldname = row[2];
      const value = row[3];
      const action = row[4];
      const status = row[5];
      const createdAt = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

      // Execute the query
      await pool.query(insertQuery, [analyticId, url, fieldname, value, action, status, createdAt]);
    }

    console.log('Data from Google Sheets dumped into the PostgreSQL database successfully');
    return 'Data from Google Sheets dumped into the database successfully';
  } catch (error) {
    console.error('Failed to insert data into the PostgreSQL database:', error);
    throw error;
  }
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
        },
      });
    },
  },
});