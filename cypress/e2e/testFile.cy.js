describe('Intercept request, perform actions, and process values', () => {
  let requestData = {}; // To store all intercepted request data
  let googleSheetData = []; // To store data fetched from Google Sheets

  before(() => {
    // Fetch data from Google Sheets
    cy.task('readGoogleSheet', { range: 'Sheet1!A:F' }).then((rows) => {
      // Filter rows that contain data
      googleSheetData = rows.filter((row, index) => {
        const hasData = row.some((cell) => cell && cell.trim());
        if (!hasData) {
          cy.log(`Skipping row ${index + 1}: No data present.`);
          return false; // Exclude rows without any data
        }
        return true; // Include rows with at least one non-empty cell
      });

      cy.log('Filtered Google Sheet Data:', JSON.stringify(googleSheetData));
    });
  });

  beforeEach(() => {
    // Catch uncaught exceptions to prevent test failure
    Cypress.on('uncaught:exception', (err) => {
      if (err.message.includes('digitalData.event is undefined')) {
        cy.log('Caught uncaught exception: ' + err.message);
        return false; // Prevent test failure on this exception
      }
      return true; // Let other exceptions fail the test
    });

    // Set up global intercept for requests (ensure wildcard to handle all analytics requests)
    cy.intercept({
      method: 'POST', // Modify if needed for other methods like POST
      url: '**https://analytics.google.com/g/collect**' // Adjust URL pattern for analytics requests
    }).as('analyticsRequests');
  });

  it('Processes data from Google Sheets, performs actions, and checks values', () => {
    if (googleSheetData.length === 0) {
      cy.log('No valid data to process.');
      return;
    }

    // Process each row with data
    cy.wrap(googleSheetData.slice(1)).each((row, index) => {
      const urlToVisit = row[1]?.trim(); // URL column
      const actions = row[4]; // Actions column

      cy.log(`Processing row ${index + 1}: URL = ${urlToVisit || 'No URL'}, Actions = ${actions || 'No Actions'}`);

      // Visit the page only if URL is present
      if (urlToVisit) {
        cy.visit(urlToVisit);
      }

      // Perform multiple actions if specified
      if (actions) {
        performActions(actions);
      }

      // Wait for intercepted request after performing actions
      cy.wait('@analyticsRequests', { timeout: 30000 }).then((interception) => {
        storeRequestData(interception, row, requestData);
      });

      // Optional: Add a slight delay before moving to the next row
      cy.wait(50000);  // Optional: Adjust based on your needs
    }).then(() => {
      cy.wait(3000)
      // After processing all rows, compare captured data
      compareWithGoogleSheetData(googleSheetData, requestData);

      // Update Google Sheet and database
      cy.wait(3000)
      cy.task('updateSheetAndDatabase').then((result) => {
        cy.log('Update result:', result);
      });
    });
  });
});

// Function to perform multiple actions
function performActions(actions) {
  const actionPairs = actions.split('|');
  let i = 0;
  while (i < actionPairs.length) {
    const actionType = actionPairs[i];
    const objectLocator = actionPairs[i + 1];
    const value = actionPairs[i + 2];

    if (actionType === 'click') {
      cy.get(objectLocator).should('exist').click({ force: true });
      i += 2; // Move to the next action
    } else if (actionType === 'type') {
      cy.get(objectLocator).should('be.visible').type(value);
      i += 3; // Move to the next action
    } else if (actionType === 'select' || actionType === 'dropdown') {
      cy.get(objectLocator).should('exist').select(value); // Dropdown selection
      i += 3; // Move to the next action
    } else {
      cy.log(`Unsupported action type: ${actionType}`);
      i += 1; // Move to the next action (skip unknown action)
    }
  }
}

// Store intercepted request data
function storeRequestData(interception, row, requestData) {
  const interceptedUrl = interception.request.url;
  const queryString = interceptedUrl.split('?')[1] || '';
  const decodedQuery = decodeURIComponent(queryString);
  const requiredParams = ['en', 'ep.action_type', 'ep.first_field_name', 'ep.first_field_id'];

  const containsRequiredParam = requiredParams.some((param) => decodedQuery.includes(param));
  if (!containsRequiredParam) {
    cy.log('Skipping this request, as it does not contain required parameters.');
    return;
  }

  const keyValuePairs = decodedQuery.split('&');
  const extractedData = {};

  keyValuePairs.forEach((pair) => {
    const [key, value] = pair.split('=');
    extractedData[key] = value || ''; // Ensuring no null value is stored
  });

  const requestId = `request_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  requestData[requestId] = { params: extractedData };

  // Log the dictionary and extracted parameters after every request interception
  cy.log('Captured Request Data:', JSON.stringify(requestData));
  cy.log('Extracted Parameters: ' + JSON.stringify(extractedData));
}

// Compare Google Sheets data with intercepted request data
function compareWithGoogleSheetData(sheetData, requestData) {
  sheetData.forEach((row, rowIndex) => {
    if (rowIndex === 0) return; // Skip the header row

    const fieldName = row[2];
    const expectedValue = row[3];
    let status = 'Fail';

    Object.values(requestData).forEach((req) => {
      const actualValue = req.params[fieldName]?.trim().toLowerCase();
      if (actualValue === expectedValue.trim().toLowerCase()) {
        status = 'Pass';
      }
    });

    cy.log(`Row ${rowIndex + 1}: Field "${fieldName}", Status: ${status}`);
    const sheetRange = `Sheet1!F${rowIndex + 1}`;

    cy.task('writeGoogleSheet', { range: sheetRange, values: [[status]] });
  });
}
