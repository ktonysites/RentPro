# RentPro – SMS Payment Listener Setup

The landlord's Android phone forwards every payment confirmation SMS to RentPro.
RentPro reads the amount, M-Pesa code, house and payer, credits the right tenant,
and lists anything it can't match under **Payments → Unmatched**.

Cost: free. The phone only uses a little mobile data. Nothing is sent to tenants.

```
Tenant pays (account 275515 <house>)
  → landlord's phone receives "Confirmed. KES. 8,700.00 ... A/C Ref. No. 275515 7 ... MPESA Ref UJH7UAL03Q ..."
  → forwarder app POSTs it to the Apps Script URL (with a secret token)
  → RentPro credits the tenant in House 7 and logs code UJH7UAL03Q
```

---

## Step 1 – Update the Apps Script backend

1. Open the Google Sheet → **Extensions → Apps Script**.
2. Replace everything in `Code.gs` with the new `google-apps-script/Code.gs` from this project, then click **Save**.
3. Go to **Project Settings** (gear icon) and check that **Time zone** is `(GMT+03:00) Nairobi`.
   Times in the SMS are read in this time zone.
4. Click **Deploy → Manage deployments**, select the existing deployment, click the ✏️ edit icon,
   set **Version: New version**, then click **Deploy**.
   Editing the existing deployment keeps the URL in `global.js`.
   Choosing **New deployment** instead would give you a different URL.

## Step 2 – Create the secret webhook URL

1. In the Apps Script editor, choose **`setupSmsWebhook`** in the function dropdown at the top and click **Run**.
   Approve the permission prompt the first time.
2. Open **Execution log**. It prints a line like:
   ```
   Paste this webhook URL into the SMS forwarder app:
   https://script.google.com/macros/s/AKfy.../exec?action=incoming_sms&token=3f9c...
   ```
3. Copy that whole URL. **Treat it like a password.** Anyone who has it can post fake payments.
   Running `setupSmsWebhook` again shows the same URL. If the URL ever leaks, run
   **`rotateSmsWebhookToken`** to get a new one, then put the new one into the phone app.

> Until Step 2 is done, the webhook refuses every message with
> "SMS webhook is not set up". This is deliberate.

## Step 3 – Install the forwarder app on the landlord's phone

Recommended app: **Incoming SMS to URL forwarder** by *bogkonstantin*. It's free and open source.
It is **not on the Google Play Store**, because Google doesn't allow SMS-forwarding apps there.
Install it from F-Droid instead:

1. On the landlord's phone, open **https://f-droid.org/packages/tech.bogomolov.incomingsmsgateway/** in Chrome.
2. Tap **Download APK**, open the downloaded file, and allow **Install unknown apps** for Chrome when Android asks.
   If Play Protect warns about the app, choose **Install anyway**. The warning appears because the app reads SMS.
3. Open the app. Allow **SMS** permission, and **Notifications** if asked (Android 13+).
4. Tap **+** to add a forwarding rule:
   | Field | Value |
   |---|---|
   | **Sender** | `*` |
   | **Text filter** (regex) | `MPESA Ref` |
   | **Webhook URL** | The URL from Step 2 |
   | **JSON template** | Leave the default `{"from":"%from%","text":"%text%",...}`. RentPro reads the `text` field. |
   | **Retries** | Leave the default (10) |

   With sender `*` and the text filter `MPESA Ref`, only payment confirmations leave the phone.
   Personal SMS are never forwarded.
5. Save the rule.

> If the app's log shows a request as failed but the payment still appears in RentPro, that's harmless.
> Apps Script answers with a redirect that some apps treat as an error and retry.
> RentPro ignores the repeats because it never records the same M-Pesa code twice.

Other apps also work if they POST the SMS text as JSON with a `message`, `text` or `body` field.
SMS Gateway for Android (sms-gate.app) and MacroDroid are two examples.

### If the APK won't install: use MacroDroid from the Play Store

MacroDroid is a Play Store automation app. Its free version allows up to 5 macros, and this needs only 1.

1. Install **MacroDroid** from the Play Store and open it. Tap **Add Macro**.
2. **Trigger:** *SMS Received*. Choose **any number**, set the content to **contains** `MPESA Ref`,
   and allow the SMS permission.
3. **Action:** *HTTP Request*.
   - Method: **POST**
   - URL: the webhook URL from Step 2
   - Body / content: insert the **SMS message** magic text (the `…` button next to the field), and nothing else
   - Content type: `text/plain`
4. Name the macro **RentPro payments** and save it.

RentPro reads the plain SMS text from the request body. The rest of this guide applies unchanged
(battery: allow MacroDroid unrestricted background use).

## Step 4 – Keep the app running

Android phones, especially Tecno, Infinix, Itel, Xiaomi and Samsung, often stop background apps.
On the landlord's phone:

- **Settings → Apps → Incoming SMS to URL forwarder → Battery → Unrestricted** (or "Don't optimise").
- If Google Messages has **RCS chats** turned on, turn them off. RCS messages aren't forwarded.
- Turn on **Autostart / Auto-launch** for the app, if the phone has that setting.
- Open the recent-apps screen and **lock** the app (padlock icon) so it isn't cleared.
- Keep **mobile data or Wi-Fi on**. If the phone is offline when an SMS arrives, the app retries later.
  A retried SMS can never be counted twice, because RentPro skips M-Pesa codes it has already recorded.

## Step 5 – Test it

1. **Connection test (records nothing).** Open this in any browser, adding your own URL in front:
   ```
   <webhook URL from Step 2>&message=hello
   ```
   Expected reply: `"Ignored: not a payment SMS"`. This means the URL and token work.
   If you see `"Invalid SMS webhook token"`, the URL was copied wrongly.
2. **Real test.** From any phone, pay a small amount (for example KES 10) to the paybill
   with account `275515 <a real house number>`.
   Within a minute, **Payments** in RentPro should show it as `Auto-matched by house ...`,
   and that tenant's Paid/Balance will update.
   This is a real payment, so the KES 10 stays credited to that tenant.

---

## How payments are matched

1. **House from the account reference.** The account `275515 7`, `275515#7` or `275515-7` gives House **7**.
   House names are compared loosely, so `7`, `07` and `House 7` all match.
2. If no tenant has that house, the payer's **phone number** is tried (when the SMS includes one).
3. Then the payer's **name**: every word of exactly one tenant's name must appear in the SMS name.
4. Otherwise the payment is saved as **Unmatched**. Open **Payments → Unmatched**
   (or `reconcile.html`), choose the tenant, and click **Confirm Assignment**. The tenant is credited then.

Other rules:

- **Duplicates:** an M-Pesa code that is already recorded is ignored. This holds whether the SMS
  was forwarded twice or the landlord also typed the payment in by hand.
- **Manual payments:** if you type an M-Pesa code that the SMS listener already captured
  into the Pay dialog, RentPro refuses it so the money isn't counted twice.
- **Non-payment SMS** (promotions, balance alerts) are ignored without an error.
- The full SMS text is kept in the Payments sheet (`SmsText` column) for auditing.

## Tell tenants how to pay

Ask tenants to always use the account number **`275515 <house number>`**, for example `275515 7`.
A wrong or missing house number sends the payment to **Unmatched**.
RentPro then tries the payer's name, but it can't be sure who paid.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Nothing appears in Payments | Run the connection test in Step 5. If it works, the phone isn't forwarding. Check the app's log, the text filter (`MPESA Ref`), battery settings and mobile data. |
| A payment SMS uses different wording | The text filter skips it. Change the filter to text that every payment SMS contains, for example `Confirmed`. |
| `Invalid SMS webhook token` | The URL in the app is wrong or out of date. Run `setupSmsWebhook` again and paste the URL it prints. |
| `SMS webhook is not set up` | Step 2 hasn't been run on this Apps Script project. |
| Payments arrive as Unmatched | The tenant used a wrong account number, or the House in the Tenants list differs from the account (for example `A7` vs `7`). Fix the tenant's House, and assign the payment from the Unmatched page. |
| Wrong time on payments | Set the Apps Script project time zone to Nairobi (Step 1.3). |
| The bank changes its SMS wording | Send a new sample SMS (hide the personal details) so the parser in `Code.gs` (`parsePaymentSms`) can be updated. |

## Testing locally (for developers)

```bash
npm test                       # backend tests, including the sample SMS
node tests/dev-server.js       # local site on http://localhost:5501 with test data
```
On the local server, sign in as `dev@rentpro.local`. Then simulate the phone:
```bash
curl -X POST "http://localhost:5501/api/exec?action=incoming_sms&token=dev-token" -d '{"text":"Confirmed. KES. 8,700.00 to NANCYWANJIRUNGARI A/C Ref. No. 275515 7 Via MPESA Ref UJH7UAL03Q by THADAYO BRIAN MASIKA on 17-10-2026 at 15:38.Thank you."}'
```
