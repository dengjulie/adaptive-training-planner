# Privacy Policy

**Train Smarter** · Last updated: October 15, 2026

Train Smarter is a personal, non-commercial training planner run by Julie Deng ("I"). It builds a training plan from your COROS history, adjusts it each morning using your Oura readiness, and keeps your sessions on your Google Calendar. This policy explains what data the app uses, why, how long it's kept, and how to delete it.

Questions or requests: julie.li.deng@gmail.com

## Summary

- The app reads your training, recovery, and calendar data to plan your training and show it back to you. From Oura it stores everything you choose to share.
- Your Oura data is kept for up to a year, and it's deleted as soon as you disconnect Oura.
- Your data is never sold, never used for advertising, and never used to train AI models. Oura data, and anything worked out from it, is never sent to any AI model.
- If you use the optional goal chat, what you type in it and a summary of your COROS training volume are sent to Anthropic's Claude so it can fill in your goal for you.
- You can disconnect any account at any time and ask me to delete everything.

## What the app collects

### Google (sign-in and calendar)

You sign in with Google, and the same consent screen covers calendar access. The app asks for:

- **Your Google account ID and email address**, to identify your account.
- **Permission to create a "Training" calendar and manage events on it.** Your planned sessions go only on that calendar. The app can't see what's on your other calendars or change them.
- **Permission to see when you're busy.** The app reads busy time blocks from your primary calendar to find open slots for sessions. It sees start and end times only, never event titles, descriptions, locations, or attendees.

Stored: your Google account ID, your email address, the ID of the Training calendar, and the app's access tokens. Busy times are read when needed and aren't stored.

Events on the Training calendar show the session as it stands that morning, for example "Easy run · 30 min", and a link to the app. They never include your readiness or other Oura values, or why a session changed.

### Oura (sleep, readiness, activity, and more)

The app asks Oura for every permission Oura offers: your email address, personal information, daily summaries, heart rate, workouts, tags, sessions, blood oxygen (SpO2), and heart health. On Oura's consent screen you can turn off any of them except daily summaries, which the app needs. The app doesn't read data you don't share.

The app reads and stores everything Oura sends for the permissions you grant:

- **Readiness, sleep, and activity scores**, and what contributed to each
- **Sleep:** every sleep period, including naps, with its timing and stages, and your heart rate, heart rate variability (HRV), breathing rate, and movement through it
- **Activity:** steps, calories, distance, time at each activity level, and your activity level through the day
- **Heart rate** through the day and night, about every five minutes
- **Body:** temperature deviation, blood oxygen (SpO2), breathing disturbances, cardiovascular age, and VO2 max
- **Stress and resilience:** time spent in high stress and in high recovery, and your resilience level
- **Workouts and sessions**, with the heart rate, HRV, and movement recorded during sessions
- **Tags and notes** you add in the Oura app, and rest mode periods
- **Bedtime recommendations**
- **Personal information:** your age, height, weight, biological sex, and the email address of your Oura account
- **Your ring:** its model, design, color, size, firmware version, setup date, and battery level

The app shows all of it back to you and uses it to plan your training. Today, your readiness score and the HRV and lowest heart rate of each night's main sleep set your normal recovery range and decide whether a day's session should be eased off.

### COROS (training history)

The app reads your workouts from COROS: sport, date, start and end time, duration, distance, and average heart rate. It reads them when you set a goal, to see how much you've been running, and each morning, to see which planned sessions you completed. The app doesn't create or change anything in your COROS account.

Most of it isn't stored. What is:

- **When a run completes a planned session:** that workout's COROS ID and how long it took, kept with the session.
- **When you set a goal:** the weekly running summary the plan starts from: minutes, distance, and number of runs per week over the last 8 weeks, your longest run, and your average pace.

### Your goal and plan

- **Your goal:** the race, its date, the days and times you can train, and your long-run day.
- **Your plan:** each planned session's day, type, length, and time slot, and whether you completed or missed it.
- **Readiness changes to the plan:** when the morning check eases a session because of your Oura readiness, the change and its reason (which quotes your readiness score and your usual range) are stored separately from the plan, and treated as Oura data. See "How long data is kept" and "Your choices".

### Information from your browser

- **Time zone**, detected when you first sign in, so that "today" and "this morning" match where you live.
- **Cookies.** One cookie keeps you signed in for up to 30 days, renewed while you use the app. While you're connecting an account, a second cookie protects that connection and expires after 10 minutes. The app has no analytics or advertising and sets no third-party cookies.

## How your data is used

Your data is used only to run the app for you. That means building and adjusting your plan, finding open times, putting sessions on your Training calendar, and showing your data back to you. Readiness-based adjustments are made by fixed rules in the app's code, not by an AI model, and their explanations are fixed text in the app, not AI-written.

### The goal chat (optional, uses AI)

When you set a goal, you can describe it in a chat instead of filling in the form. The chat uses Claude, an AI model made by Anthropic, which turns what you write into a draft goal and fills in the form for you to check. Nothing happens to your plan until you submit the form yourself.

Each time you send a message, the app sends Anthropic:

- the conversation so far: what you typed and Claude's replies
- today's date
- your COROS training summary: weekly running minutes, distance, and number of runs over the last 4 weeks, your longest run in the last 8 weeks, and your average pace

It never sends your Oura data or anything worked out from it, including readiness-based changes to your plan. It also never sends your individual workouts, your calendar, your email address, or your name. The app checks this with automated tests on every change. If you don't use the chat, nothing is sent to Anthropic. Anthropic handles what it receives under its commercial terms for API customers.

## Sharing

Your data isn't sold, rented, or shared for advertising. It's shared only in these cases:

- with Google, Oura, and COROS, when the app requests your data from them or writes sessions to your calendar on your behalf
- with Anthropic, only when you use the goal chat, as described above
- with the hosting provider that runs the app's server and database, which stores the data on my behalf
- when required by law

## Storage and security

- Data is stored in a Postgres database on the server that runs the app.
- The app's access tokens for Google, Oura, and COROS are encrypted (AES-256-GCM) before they're stored. Sign-in sessions are stored only as one-way hashes.
- The app connects to Google, Oura, and COROS over HTTPS. Outside local development, the app itself is served only over HTTPS.
- Server logs record requests, errors, and summaries of the morning sync, such as how many days were synced, which kinds of Oura data weren't shared, and how many sessions were completed or changed, so that problems can be fixed. They don't record your Oura values, such as scores, sleep, or heart rate, why a session changed, your workout details, or what you write in the goal chat.
- If a security incident affects your data, I'll tell you promptly.

## How long data is kept

| Data | How long it's kept |
|---|---|
| Oura data, except your personal information and ring details | 1 year, then deleted automatically |
| Oura personal information and ring details | Replaced each time the app syncs; deleted when you disconnect Oura |
| Readiness-based changes to your plan | Like Oura data: 1 year, and deleted when you disconnect Oura |
| Your goal and plan, including completed sessions' COROS workout IDs and durations, and the training summary the plan started from | Until you ask me to delete it. Setting a new goal replaces sessions from that day on; past ones are kept |
| Other COROS workout details, and Google busy times | Not stored |
| Goal chat messages | Not stored by the app |
| The app's access tokens for a service | Until you disconnect that service |
| Your account (Google ID, email, time zone, Training calendar ID) | Until you ask me to delete it |

## Your choices

You can disconnect a service at any time on the Connections page. What happens depends on the service:

- **Oura:** the app revokes its access and immediately deletes your stored Oura data and tokens, including readiness-based changes to your plan. Your sessions go back to how they were planned.
- **Google:** the app revokes its access and deletes its tokens. Your Training calendar stays in your Google account; you can delete it in Google Calendar.
- **COROS:** the app deletes its tokens. COROS doesn't let apps revoke their own access.

If you remove the app's access on Google's, Oura's, or COROS's side instead (for Google, at myaccount.google.com/permissions), the app stops reading from that service once it notices. Disconnect in the app as well so stored data is deleted right away.

To get a copy of your data or have all of it deleted, email julie.li.deng@gmail.com. Deletion is completed within 72 hours.

## Children

Train Smarter is for adults. Don't use it if you're under 18.

## Changes

If this policy changes, the date at the top changes too. If a change affects how your data is used, you'll be told in the app or by email before it takes effect.

## Contact

Julie Deng · julie.li.deng@gmail.com
