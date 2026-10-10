# Privacy Policy

**Train Smarter** · Last updated: October 9, 2026

Train Smarter is a personal, non-commercial training planner run by Julie Deng ("I"). It builds a training plan from your COROS history, adjusts it each morning using your Oura readiness, and keeps your sessions on your Google Calendar. This policy explains what data the app uses, why, how long it's kept, and how to delete it.

Questions or requests: julie.li.deng@gmail.com

## Summary

- The app reads only the data it needs to plan your training, and stores only a small part of it.
- Your Oura data is kept for at most 60 days, and it's deleted as soon as you disconnect Oura.
- Your data is never sold, never used for advertising, and never used to train AI models. Oura data is never sent to any AI model.
- You can disconnect any account at any time and ask me to delete everything.

## What the app collects

### Google (sign-in and calendar)

You sign in with Google, and the same consent screen covers calendar access. The app asks for:

- **Your Google account ID and email address**, to identify your account.
- **Permission to create a "Training" calendar and manage events on it.** Your planned sessions go only on that calendar. The app can't see what's on your other calendars or change them.
- **Permission to see when you're busy.** The app reads busy time blocks from your primary calendar to find open slots for sessions. It sees start and end times only, never event titles, descriptions, locations, or attendees.

Stored: your Google account ID, your email address, the ID of the Training calendar, and the app's access tokens. Busy times are read when needed and aren't stored.

### Oura (readiness and recovery)

The app asks Oura only for the `daily` permission and reads your daily readiness and sleep records. For each day it stores three values:

- your readiness score
- your average heart rate variability (HRV) during the night's main sleep
- your lowest heart rate during the night's main sleep, used as your resting heart rate

Nothing else from Oura is stored. These values set your normal recovery range and decide whether a day's session should be eased off. Each day's values are deleted automatically after 60 days.

### COROS (training history)

The app reads your workouts from COROS: sport, date, start and end time, duration, distance, and average heart rate. Currently it reads them when you open the app and once each morning to see what you completed, and doesn't store them. The app doesn't create or change anything in your COROS account.

### Information from your browser

- **Time zone**, detected when you first sign in, so that "today" and "this morning" match where you live.
- **Cookies.** One cookie keeps you signed in for up to 30 days, renewed while you use the app. While you're connecting an account, a second cookie protects that connection and expires after 10 minutes. The app has no analytics or advertising and sets no third-party cookies.

## How your data is used

Your data is used only to run the app for you. That means building and adjusting your plan, finding open times, putting sessions on your Training calendar, and showing your data back to you. Readiness-based adjustments are made by fixed rules in the app's code, not by an AI model.

The app doesn't send any of your data to an AI model. If AI features are added later, for example explaining plan changes in plain language, this policy will be updated before they're turned on. Oura data will never be included in what's sent.

## Sharing

Your data isn't sold, rented, or shared for advertising. It's shared only in these cases:

- with Google, Oura, and COROS, when the app requests your data from them or writes sessions to your calendar on your behalf
- with the hosting provider that runs the app's server and database, which stores the data on my behalf
- when required by law

## Storage and security

- Data is stored in a Postgres database on the server that runs the app.
- The app's access tokens for Google, Oura, and COROS are encrypted (AES-256-GCM) before they're stored. Sign-in sessions are stored only as one-way hashes.
- The app connects to Google, Oura, and COROS over HTTPS. Outside local development, the app itself is served only over HTTPS.
- Server logs record requests, errors, and summaries of the morning sync, such as how many days were synced, so that problems can be fixed. They don't record your readiness scores, sleep, or workout details.
- If a security incident affects your data, I'll tell you promptly.

## How long data is kept

| Data | How long it's kept |
|---|---|
| Oura readiness score, HRV, and resting heart rate | 60 days, then deleted automatically |
| COROS workouts and Google busy times | Not stored |
| The app's access tokens for a service | Until you disconnect that service |
| Your account (Google ID, email, time zone, Training calendar ID) | Until you ask me to delete it |

## Your choices

You can disconnect a service at any time on the Connections page. What happens depends on the service:

- **Oura:** the app revokes its access and immediately deletes your stored Oura data and tokens.
- **Google:** the app revokes its access and deletes its tokens. Your Training calendar stays in your Google account; you can delete it in Google Calendar.
- **COROS:** the app deletes its tokens. COROS doesn't let apps revoke their own access.

If you remove the app's access on Google's, Oura's, or COROS's side instead (for Google, at myaccount.google.com/permissions), the app stops reading from that service once it notices. Disconnect in the app as well so stored data is deleted right away.

To get a copy of your data or have all of it deleted, email julie.li.deng@gmail.com. Deletion is completed within 72 hours.

## Children

Train Smarter is for adults. Don't use it if you're under 18.

## Changes

If this policy changes, the date at the top changes too. If a change affects how your data is used, you'll be told in the app or by email before it takes effect.

## Contact

Julie Deng· julie.li.deng@gmail.com
