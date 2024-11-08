const fs = require('fs');
const Papa = require('papaparse');  // You can remove this if you're not using it anymore

describe('Intercept request, perform actions, and process values', () => {
  let requestData = {}; // Dictionary to store all intercepted request data
  let googleSheetData = []; // Array to store data fetched from Google Sheets

  before(() => {
    // Fetch data from Google Sheets before running tests
    cy.task('readGoogleSheet', { range: 'Sheet1!A:F' }).then((rows) => {
      googleSheetData = rows; // Store the data from Google Sheets
      cy.log('Fetched data from Google Sheets:', googleSheetData);
    });
  });

  beforeEach(() => {
    // Catch uncaught exceptions to prevent test failure
    Cypress.on('uncaught:exception', (err) => {
      if (err.message.includes('digitalData.event is undefined')) {
        cy.log('Caught uncaught exception: ' + err.message);
        return false; // Prevents Cypress from failing the test
      }
    });
  });

  it('Processes data from Google Sheets, performs actions, and checks values', () => {
    if (googleSheetData.length === 0) {
      cy.log('No valid data to process.');
      return;
    }

    // Process each row asynchronously
    cy.wrap(googleSheetData).each((row, index) => {
      const urlToVisit = row[0]; // Assuming the URL is in the first column
      const action = row[3]; // Assuming the action is in the fourth column

      // Visit the page
      cy.visit(urlToVisit).then(() => {
        // Check if there's an action to perform
        if (action && action.includes('|')) {
          const [actionType, objectLocator] = action.split('|');
          const valueToType = row[2]; // Assuming there's a 'Value' in the third column

          if (actionType === 'click') {
            cy.get(objectLocator).should('exist')
              .click({ force: true })
              .then(() => {
                cy.log(`Clicked on element: ${objectLocator}`);
                cy.wait(1000); // Wait for any actions post-click

                // Intercept the request after the action and apply 'ep.Action' filter
                cy.intercept('POST', '**https://analytics.google.com/g/collect**').as('requestAfterClick');
                cy.wait('@requestAfterClick', { timeout: 10000 }).then((interception) => {
                  storeRequestData(interception, row, requestData, true); // Pass true to check 'ep.Action' after click
                });
              });
          } else if (actionType === 'type') {
            cy.get(objectLocator)
              .should('be.visible')
              .type(valueToType)
              .then(() => {
                cy.log(`Typed "${valueToType}" into element: ${objectLocator}`);
                cy.wait(1000);

                // Intercept the request after the action and apply 'ep.Action' filter
                cy.intercept('POST', '**https://analytics.google.com/g/collect**').as('requestAfterType');
                cy.wait('@requestAfterType', { timeout: 10000 }).then((interception) => {
                  storeRequestData(interception, row, requestData, true); // Pass true to check 'ep.Action' after typing
                });
              });
          }
        } else {
          // If no action, intercept the request without checking 'ep.Action'
          cy.intercept('POST', '**https://analytics.google.com/g/collect**').as('requestWithoutAction');
          cy.wait('@requestWithoutAction', { timeout: 10000 }).then((interception) => {
            storeRequestData(interception, row, requestData, false); // Pass false to skip 'ep.Action' check
          });
        }
      });
    }).then(() => {
      // Final assertions after all requests are captured
      compareWithGoogleSheetData(googleSheetData, requestData);
    });
  });
});

// Helper function to store intercepted request data
function storeRequestData(interception, row, requestData, checkForEpAction = false) {
  const interceptedUrl = interception.request.url;
  const queryString = interceptedUrl.split('?')[1] || '';
  const decodedQuery = decodeURIComponent(queryString);
  const keyValuePairs = decodedQuery.split('&');

  const extractedData = {};
  keyValuePairs.forEach((pair) => {
    const [key, value] = pair.split('=');
    extractedData[key] = value || '';
  });

  cy.log('Extracted Parameters: ' + JSON.stringify(extractedData));

  // Only filter by 'ep.Action' if specified
  if (checkForEpAction && (!extractedData['ep.Action'] || !extractedData['ep.Label'] || !extractedData['ep.Category'])) {
    cy.log('Skipping this request, as it does not contain ep.Action.');
    return; // Skip requests without 'ep.Action' after actions
  }

  const requestId = `request_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  requestData[requestId] = {
    url: interceptedUrl,
    status: interception.response.statusCode,
    headers: interception.response.headers,
    request_id: requestId,
    timestamp: interception.timestamp,
    params: extractedData,
  };
  console.log('Current requestData:', requestData);
  return extractedData;
}

// Function to compare Google Sheets data with intercepted request data
function compareWithGoogleSheetData(sheetData, requestData) {
  sheetData.forEach(row => {
    const fieldName = row[1]; // Assuming the 'Fieldname' is in the second column
    const expectedValue = row[2]; // Assuming the 'Value' is in the third column

    let status = 'Fail'; // Default status
    let actualValue = '';

    // Iterate through intercepted request data
    Object.values(requestData).forEach(req => {
      if (req.params[fieldName]) {
        actualValue = req.params[fieldName]?.trim().toLowerCase() || '';
        const expectedValueTrimmed = expectedValue.trim().toLowerCase();

        cy.log(`Field: ${fieldName}, Expected: "${expectedValueTrimmed}", Actual: "${actualValue}"`);

        if (actualValue === expectedValueTrimmed) {
          status = 'Pass';
        }
      }
    });

    if (!actualValue) {
      cy.log(`Warning: Field "${fieldName}" not found in any captured requests.`);
    }

    // Log status
    cy.log(`Field: ${fieldName}, Status: ${status}`);
  });
}
