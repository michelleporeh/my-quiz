# Chapter 26 wishlist: setup

The site has two parts:

- **The pages** (`index.html` for guests, `admin.html` for you), hosted free on GitHub Pages.
- **The backend**, a Google Sheet with a small script. It stores the list and the claims, and it emails you when something changes. It's free and runs under your Google account. Guests don't need any account.

## 1. Create the backend (about 5 minutes)

1. Go to [sheets.new](https://sheets.new) and name the sheet something like "Chapter 26 wishlist".
2. In the sheet's menu, choose **Extensions → Apps Script**.
3. Delete the sample code. Paste in everything from `apps-script/Code.gs`, then click **Save** (the disk icon).
4. Choose **setup** from the function dropdown at the top and click **Run**.
   - Google will ask for permissions. Click **Review permissions**, pick your account, then **Advanced → Go to (project name)** and **Allow**. Google warns you because the script is yours and hasn't been "verified"; that's expected.
   - When it finishes, open **Execution log**. Copy the **admin key** it prints. That key is your password for the edit page.
5. Click **Deploy → New deployment**, open the gear icon, and choose **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
6. Open `config.js` and paste that URL between the quotes:
   ```js
   window.WISHLIST_API_URL = 'https://script.google.com/macros/s/…/exec';
   ```

> If you change `Code.gs` later, go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. That keeps the same URL.

## 2. Put the site online

Commit and push the `wishlist/` folder. If GitHub Pages is on for this repo (**Settings → Pages**, serving the `quiz` branch), the site will be at:

- Guests: `https://michelleporeh.github.io/my-quiz/wishlist/`
- You: `https://michelleporeh.github.io/my-quiz/wishlist/admin.html`

## 3. Add your wishes

Open the admin page and paste your admin key. Then add items. **Ranking** sets order: 1 is what you want most. If you give an item a rank that's already taken, everything below it moves down one.

**How many?** works like this:

- `1`: once one person claims it, it's closed.
- A bigger number (like `2`): it closes after that many claims.
- **No limit**: anyone can claim it, any number of times.

Unlocking the admin page also marks that device as yours, so the guest page there stops showing claims. Do this on every device you'll open the wishlist on, like your phone.

## What you'll see and what you won't

- **Email:** you get "someone updated your wishlist" whenever a guest claims or unclaims something. You get at most one every 15 minutes, and it never says what changed.
- **The page doesn't show when it was last updated**, so guests can't see that either.
- **Claims stay hidden from you.** They live in a hidden **Claims** tab in the Sheet. That's the "unless you go digging" spot.
- **Guests are anonymous.** Their browser keeps a private token, so only the person who claimed an item can unclaim it, and only from the same browser.

To change where emails go, open Apps Script, go to **Project Settings → Script properties**, and edit `NOTIFY_EMAIL`.
