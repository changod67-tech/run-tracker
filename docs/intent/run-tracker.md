# Intent: Run Tracker

Confirmed with the user on 2026-10-29.

- **Outcome:** A polished running-plan app on the iPhone home screen. It shows today's workout, the current week (phase, goal, days, weekly total), and the full plan, so the plan stays off the calendar.
- **User:** Just the owner, training for a 10K after a half marathon.
- **Why now:** A 4-week block starts Mon Nov 2, 2026.
- **Success:** Open the app, see today's run with its steps and notes, and tap Done or Skipped. Fitbit runs that reach Strava check themselves off. Swapping in a new plan takes minutes.
- **Customization:**
  - Paste in a plan in the text format below.
  - Edit, move or delete any workout (the Thanksgiving 10K is optional).
  - Keep multiple plans and switch between them.
- **Constraints:**
  - It's a web app added to the home screen, hosted free on GitHub Pages, and works offline.
  - No Mac and no paid Apple developer account.
  - Data stays on the phone (localStorage).
  - Strava keys are entered in the app's settings, never committed.
- **Out of scope:**
  - The App Store and sideloading.
  - Apple Health and Google Fit (both blocked for web apps).
  - Tracking pace or heart rate (Strava does that).
  - Generating training plans.
  - Push notifications and syncing across devices.

## Plan text format

```
Week 1 · Nov 2–8
Recovery
Goal: Recover from the half marathon and ease back into running.
Tue 3
Easy run — 2–3 miles
Very comfortable effort. You should be able to hold a full conversation.
...
Weekly total: approximately 11–13 miles
```

Each day is a `Day N` line, then a `Title — distance` line, then optional step lines and a closing note.
