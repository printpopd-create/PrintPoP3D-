# PrintPoP 3D — Website + Admin

**Design it. Print it. Love it.**

A shop page for your fidgets and custom prints, plus a private admin page where
you edit everything yourself — no code, no re-uploading files.

---

## Starting the site

Open a terminal in this folder and run:

```bash
npm start
```

Then open:

| Page | Address | What it's for |
|---|---|---|
| **Shop** | http://localhost:3000 | What your customers see |
| **Admin** | http://localhost:3000/admin | Where you edit it |

To stop it, press `Ctrl + C` in that terminal.

> There is nothing to install. It runs on Node.js alone — no packages, so
> nothing can break or go out of date.

---

## The first time you open /admin

It will ask you to **choose a password**. Pick one, type it twice, done.

**Write that password down somewhere safe.** There is no "forgot password"
email — if you lose it, the only fix is deleting the file `data/admin.json`,
which lets you set a new one.

---

## What you can change from the admin page

### Products tab
- Add, edit, delete products
- Change name, price, description, and the little detail pills
- **Upload a photo** — pick it from your phone or computer and it uploads
  straight away. It gets shrunk automatically so the page stays fast.
- Move products up and down to reorder the shop
- **Hide** a product instead of deleting it (useful when you're out of filament)
- Turn the bundle deal on or off and set its price

### Page text tab
Every heading and paragraph on the shop, plus the badges, the "how it works"
steps, and the footer.

> **Tip:** put `*stars*` around words to make them glow in your brand colors.
> `Fidgets, *ready to print*` makes the second half glow.

### Contact tab
Your TikTok and Instagram usernames, and your WhatsApp number.

**Leave one empty and its buttons disappear from the whole site.** So when you
open the Instagram account, just type the username here and it switches on
everywhere at once.

### Password tab
Change your password, or reset the whole site back to how it shipped.

---

## Nothing saves until you press Save

Changes stay on your screen until you press the **Save changes** button at the
bottom. Until then the top bar says *Unsaved changes*, and **Undo my changes**
throws them away. Once you save, the shop updates instantly for everyone.

---

## Why WhatsApp is worth turning on

Instagram and TikTok don't allow a website to write the message for a customer.
The best the shop can do is copy `Hi! I'd like to order the Flexi Dragon ($12)`
to their clipboard and tell them to paste it.

WhatsApp *does* allow it. Once you add your number, the message is already
typed when their chat opens — they just hit send. Fewer people give up, and you
stop getting "hi how much" with no idea which item they mean.

That's why WhatsApp becomes the main button once it's switched on.

---

## Your photos

The three product pictures are drawings, not photos. Replace them as soon as
you've printed the real thing — a real photo of a real print sells far better.
Just open the product in the admin and press **Upload photo**.

---

## What's in the folder

| Item | What it is |
|---|---|
| `server.js` | Runs the site |
| `lib/` | The engine — auth, storage, page building |
| `public/` | The shop page, admin page, styles, your logo |
| `data/site.json` | **All your products and text live here** |
| `data/admin.json` | Your password, stored scrambled (created on first login) |
| `data/uploads/` | Photos you upload |

### Backing up

Copy the whole **`data`** folder somewhere safe now and then. That one folder is
your entire shop — products, text and photos. Nothing else is irreplaceable.

---

## About your password

It's stored using **scrypt**, which scrambles it one way — even someone holding
the file can't read it back. Logins use a signed, HttpOnly cookie, and after 8
wrong guesses the login locks for 15 minutes.

Two honest limits:

1. **Use HTTPS when you put this online.** On a plain `http://` address someone
   on the same Wi-Fi could capture your password as you log in. Any host worth
   using gives you HTTPS free — just don't skip it.
2. **This is one password, for you.** It isn't built for staff accounts with
   different permissions. If you ever hire help, that's the point to upgrade.

---

## Putting it online

This needs a host that **runs Node.js and keeps its files** — a plain static
host like Netlify won't work now that there's a login and a database.

What matters when you pick one: it must have a **persistent disk** (sometimes
called a "volume"). Without one, every restart wipes `data/` and your products
vanish. Hosts that offer this include Railway, Fly.io, Render (paid tier), or
any small VPS.

Whatever you choose, set these:

- Start command: `npm start`
- The host provides the port automatically via the `PORT` variable — the site
  already reads it
- Mount the persistent disk at the `data` folder
- Turn HTTPS on

Ask me when you're ready and I'll walk you through whichever host you pick.

---

## Before you launch — checklist

- [ ] Open the Instagram account `@printpop3d` and add it in the Contact tab
- [ ] Print the 3 fidgets and upload real photos
- [ ] Check the prices are what you actually want to charge
- [ ] Add your WhatsApp number once you have the business line
- [ ] Copy the `data` folder somewhere safe
