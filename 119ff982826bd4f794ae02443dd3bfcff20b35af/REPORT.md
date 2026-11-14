# Live test report

Commit 119ff982826bd4f794ae02443dd3bfcff20b35af

**18 passed, 0 failed, 0 skipped**

| Device | Test | Result | ms | Error |
|---|---|---|---|---|
| android-chrome | 1. demo code opens the demo shop in English | PASS | 7948 |  |
| android-chrome | 2. Appearance: colour changes instantly and is remembered | PASS | 794 |  |
| android-chrome | 3. New customer: keyboard ready, 3 fields, one tap saves | PASS | 1508 |  |
| android-chrome | 4. Search on home, open the customer, delete is blocked while money is due | PASS | 511 |  |
| android-chrome | 5. You gave ₹: entry opens for that customer, cursor in amount, one tap saves | PASS | 1237 |  |
| android-chrome | 6. Home shows totals and sorts the list | PASS | 662 |  |
| android-chrome | 7. You got ₹: full payment in one tap, balance becomes 0 | PASS | 1126 |  |
| android-chrome | 8. Delete at ₹0: gone from lists, history kept | PASS | 1039 |  |
| android-chrome | 9. Speed: screens open from memory | PASS | 833 |  |
| iphone-safari | 1. demo code opens the demo shop in English | PASS | 9479 |  |
| iphone-safari | 2. Appearance: colour changes instantly and is remembered | PASS | 3294 |  |
| iphone-safari | 3. New customer: keyboard ready, 3 fields, one tap saves | PASS | 3716 |  |
| iphone-safari | 4. Search on home, open the customer, delete is blocked while money is due | PASS | 1883 |  |
| iphone-safari | 5. You gave ₹: entry opens for that customer, cursor in amount, one tap saves | PASS | 1939 |  |
| iphone-safari | 6. Home shows totals and sorts the list | PASS | 1955 |  |
| iphone-safari | 7. You got ₹: full payment in one tap, balance becomes 0 | PASS | 2752 |  |
| iphone-safari | 8. Delete at ₹0: gone from lists, history kept | PASS | 1798 |  |
| iphone-safari | 9. Speed: screens open from memory | PASS | 2004 |  |

## Timings (ms)

```json
{
  "android-chrome": {
    "timings": {
      "open demo page": 407,
      "demo sign-in → home": 7434,
      "tap New → name box ready": 144,
      "save new customer + credit": 955,
      "tap customer → customer page": 356,
      "save credit for existing customer": 1054,
      "save payment → back to customer": 862,
      "delete customer": 353,
      "home → More menu → customers (cached)": 407,
      "page ttfb": 18,
      "page domReady": 39,
      "page load": 75
    },
    "consoleErrors": [],
    "customer": "Live Test 1114031386"
  },
  "iphone-safari": {
    "timings": {
      "open demo page": 299,
      "demo sign-in → home": 8993,
      "tap New → name box ready": 767,
      "save new customer + credit": 2446,
      "tap customer → customer page": 1656,
      "save credit for existing customer": 1065,
      "save payment → back to customer": 1599,
      "delete customer": 765,
      "home → More menu → customers (cached)": 1408,
      "page ttfb": 72,
      "page domReady": 116,
      "page load": 138
    },
    "consoleErrors": [],
    "customer": "Live Test 1114031320"
  }
}
```
