const { defineConfig } = require('cypress');
const { google } = require('googleapis');
const { Pool } = require('pg'); // PostgreSQL package
const moment = require('moment-timezone'); // For handling timezones
const fs = require('fs');

// Load database credentials from the environment variable DB_CONNECTION_SECRET
let dbConfig;
try {
  const dbConfigString = process.env.DB_CONNECTION_SECRET;
  if (!dbConfigString) {
    throw new Error('DB_CONNECTION_SECRET is not set.');
  }
  dbConfig = JSON.parse(dbConfigString);
} catch (err) {
  console.error('Error loading DB_CONNECTION_SECRET:', err);
  throw new Error('Unable to load database configuration from the secret.');
}

// PostgreSQL connection configuration
const pool = new Pool(dbConfig);

async function authorize() {
  const SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_CREDENTIALS_FILE_PATH;

  if (!SERVICE_ACCOUNT_KEY_PATH) {
    throw new Error('GOOGLE_CREDENTIALS_FILE_PATH is not set.');
  }

  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_KEY_PATH, 'utf8'));
  } catch (error) {
    throw new Error('Failed to read or parse the service account key file: ' + error.message);
  }

  if (typeof credentials.private_key !== 'string' || typeof credentials.client_email !== 'string') {
    throw new Error('Invalid private_key or client_email format in the credentials file.');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return auth.getClient();
}

async function readGoogleSheet() {
  const authClient = await authorize();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const spreadsheetId = '1_dfBa_dLSQDm4QqHUMIvrN9adNL6ga-lUGp4xFDNaqQ'; // Replace with your actual sheet ID
  const sheetRange = 'Sheet1!A:F'; // Range in the sheet

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetRange,
  });

  const rows = res.data.values;
  if (!rows || rows.length === 0) {
    console.log('No data found.');
    return [];
  }

  return rows;
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

// Function to insert data into the PostgreSQL database
async function insertDataIntoDatabase(sheetData) {
  try {
    // Ensure the database table exists
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
      let status = row[5]; // Get current status
      const createdAt = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

      // Perform your action here (for example, change status based on some conditions)
      if (status === 'Pending') {
        status = 'Completed'; // Example action: change 'Pending' to 'Completed'
      }

      // Insert into database
      await pool.query(insertQuery, [analyticId, url, fieldname, value, action, status, createdAt]);

      // Update the status in the sheet as well
      row[5] = status; // Update the row with new status
    }

    console.log('Data successfully inserted into the PostgreSQL database and sheet status updated');
    return 'Data successfully inserted into the database and sheet status updated';
  } catch (error) {
    console.error('Failed to insert data into the PostgreSQL database:', error);
    throw error;
  }
}

module.exports = defineConfig({
  e2e: {
    baseUrl: process.env.BASE_URL || 'https://dev1.credello.com/', // Default fallback if not provided
    setupNodeEvents(on, config) {
      on('task', {
        async readGoogleSheet() {
          return await readGoogleSheet(); // Read sheet data
        },

        async writeGoogleSheet({ range, values }) {
          const spreadsheetId = '1_dfBa_dLSQDm4QqHUMIvrN9adNL6ga-lUGp4xFDNaqQ'; // Replace with your actual sheet ID
          return await writeGoogleSheet({ spreadsheetId, range, values });
        },

        async updateSheetAndDatabase() {
          // Step 1: Read data from Google Sheet
          const sheetData = await readGoogleSheet();

          // Step 2: Insert data into database and update the status column
          await insertDataIntoDatabase(sheetData);

          // Step 3: Write updated data (including the status) back to Google Sheet
          const spreadsheetId = '1_dfBa_dLSQDm4QqHUMIvrN9adNL6ga-lUGp4xFDNaqQ'; // Replace with your actual sheet ID
          const range = 'Sheet1!A:F'; // Replace with the correct range
          await writeGoogleSheet({ spreadsheetId, range, values: sheetData });

          return 'Sheet and database updated successfully';
        },
      });
    },
  },
});
