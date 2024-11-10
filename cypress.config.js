const { defineConfig } = require('cypress');
const { google } = require('googleapis');
const path = require('path');

// Path to the service account key file
const SERVICE_ACCOUNT_KEY_PATH = 'cypress/fixtures/credentials.json';

async function authorize() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY_PATH, // Ensure this path is correct
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
      });
    },
  },
});
