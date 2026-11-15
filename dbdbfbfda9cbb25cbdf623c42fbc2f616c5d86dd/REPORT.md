# Live test report

Commit dbdbfbfda9cbb25cbdf623c42fbc2f616c5d86dd

**18 passed, 0 failed, 0 skipped**

| Device | Test | Result | ms | Error |
|---|---|---|---|---|
| android-chrome | 1. demo code opens the demo shop in English | PASS | 10773 |  |
| android-chrome | 2. Appearance: colour changes instantly and is remembered | PASS | 584 |  |
| android-chrome | 3. New customer: keyboard ready, 3 fields, one tap saves | PASS | 1756 |  |
| android-chrome | 4. Search on home, open the customer, delete is blocked while money is due | PASS | 916 |  |
| android-chrome | 5. You gave ₹: entry opens for that customer, cursor in amount, one tap saves | PASS | 1161 |  |
| android-chrome | 6. Home shows totals and sorts the list | PASS | 438 |  |
| android-chrome | 7. You got ₹: full payment in one tap, balance becomes 0 | PASS | 1691 |  |
| android-chrome | 8. Delete at ₹0: gone from lists, history kept | PASS | 1265 |  |
| android-chrome | 9. Speed: screens open from memory | PASS | 790 |  |
| iphone-safari | 1. demo code opens the demo shop in English | PASS | 7225 |  |
| iphone-safari | 2. Appearance: colour changes instantly and is remembered | PASS | 1171 |  |
| iphone-safari | 3. New customer: keyboard ready, 3 fields, one tap saves | PASS | 2156 |  |
| iphone-safari | 4. Search on home, open the customer, delete is blocked while money is due | PASS | 1329 |  |
| iphone-safari | 5. You gave ₹: entry opens for that customer, cursor in amount, one tap saves | PASS | 1434 |  |
| iphone-safari | 6. Home shows totals and sorts the list | PASS | 915 |  |
| iphone-safari | 7. You got ₹: full payment in one tap, balance becomes 0 | PASS | 1756 |  |
| iphone-safari | 8. Delete at ₹0: gone from lists, history kept | PASS | 1726 |  |
| iphone-safari | 9. Speed: screens open from memory | PASS | 1420 |  |

## Timings (ms)

```json
{
  "android-chrome": {
    "timings": {
      "open demo page": 1292,
      "demo sign-in → home": 9428,
      "tap New → name box ready": 66,
      "save new customer + credit": 1067,
      "tap customer → customer page": 827,
      "save credit for existing customer": 1034,
      "save payment → back to customer": 1334,
      "delete customer": 829,
      "home → More menu → customers (cached)": 509,
      "page ttfb": 37,
      "page domReady": 52,
      "page load": 75
    },
    "consoleErrors": [],
    "customer": "Live Test 1115115838"
  },
  "iphone-safari": {
    "timings": {
      "open demo page": 447,
      "demo sign-in → home": 6692,
      "tap New → name box ready": 366,
      "save new customer + credit": 1249,
      "tap customer → customer page": 1212,
      "save credit for existing customer": 1017,
      "save payment → back to customer": 949,
      "delete customer": 1043,
      "home → More menu → customers (cached)": 983,
      "page ttfb": 32,
      "page domReady": 90,
      "page load": 114
    },
    "consoleErrors": [],
    "customer": "Live Test 1115115925"
  }
}
```
