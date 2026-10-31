# Cohdit Hatch

Hatch the idea you have been sitting on: say it, answer a few questions, get an app your friends can open.

Hatch is for people who don't write software. You describe what you want in plain words; Hatch asks
you the questions an experienced builder would, builds it, lets you try it on your own computer, and
puts it at a free link you can send to anyone. It can always tell you what it is doing and why.

> Today, **set me up**, **I have an idea**, **build it**, **let me try it**, **share it** and **fix the bugs** work. **Status** is coming. See `CHANGELOG.md`.

## Before you start

You need:

- an email address
- a Claude plan that includes Claude Code: Pro, Max, Team or Enterprise. The free plan does not.
- a computer you can install things on, online
- [Claude Code](https://claude.com/claude-code) installed and signed in to that account. It is a
  separate app from the Claude you may already use. There is a desktop app for Mac and Windows.

A build uses a lot of your Claude plan. On a smaller plan Claude may pause you until your limit
resets; nothing is lost, and Hatch carries on from where it stopped when you come back.

What Hatch touches: it signs you in to two free accounts you own, GitHub, where your code is kept,
and Vercel, where your link lives. It never sees or stores a password. Everything it builds is in
your accounts and is yours. While it builds, it edits files inside its own Hatch folder on your computer
without asking you each time; it touches nothing outside that folder. There are two kinds of idea it will
not build; see the end of this page.

## Install

Open Claude Code and paste this line:

```
/plugin install hatch --marketplace Cohdit/cohdit-hatch
```

Claude Code asks two things. First it shows where it is getting Hatch from; say yes. Then it asks how
to install; choose **Install for you**. When it says Hatch is active, type here: **set me up**

Hatch checks what your computer can do and walks you through anything missing, one thing at a time.

<details>
<summary>If that line is not recognised</summary>

Your Claude Code is older. Paste these two lines, one at a time, waiting for the first to finish:

```
/plugin marketplace add Cohdit/cohdit-hatch
/plugin install hatch@cohdit-hatch
```
</details>

## The seven things you can say

| Say | What happens |
|---|---|
| **set me up** | Checks your computer and walks you through anything missing. Once per computer. |
| **I have an idea** | You talk, Hatch listens and asks the odd question. At the end it reads your idea back in your words, and your yes saves it as a short list of things to build. |
| **build it** | Builds the whole first version while you leave the laptop open, checks its own work, keeps a copy in your GitHub account, and tells you what's done and what needs you. Say it on any computer, in as many windows as you like; Hatch shares the work. Ends by asking you to try it. |
| **let me try it** | Opens the app on your computer with a short checklist in your own words. Say *pass*, or say which one didn't work and what you saw; that goes straight into the next build. Always before sharing. |
| **share it** | One question, then it goes live at a link anyone can open, on your own hosting account. Only after you've tried it, and only when you say yes. Says what to do if something at the link is wrong. |
| **fix the bugs** | Pulls in what people reported from the "Something wrong?" link every app has, then four reviewers read the whole app for bugs, security holes, surprise costs and privacy leaks. What they find goes on the list, and "build it" fixes it. Say "fix the bugs every week" and Hatch tells you when a check is due. |
| **status** / **why did it stop** | Where things stand, how much Claude it has used, what is waiting on you. |

## How it talks to you

Plainly, unless you say otherwise. Hatch never asks; you change it by saying so, once.

| Say | You get |
|---|---|
| **talk to me plainly** | Everyday words. No jargon, no code, the fewest possible questions; Hatch makes the small choices for you and tells you it did. |
| **talk to me like a product person** | You know how software gets made. Process words and counts; design and data choices put to you as options with consequences. |
| **talk to me like a developer** | The same short sentences, with a technical term wherever it is the clearer word. Say "show me the details" for the raw event view. |

Say "technical" or "plainly" to change just one reply. The same facts produce the same words every
time, so what Hatch tells you is something you can rely on and repeat.

## What it costs

Hatch is free. The recommended place to put your app is free. The one thing Hatch uses up is your own
Claude plan. After every run Hatch tells you how many tokens it used, and what those tokens would come to
at Claude's public API prices, so you can see where the figure comes from. That dollar figure is an
estimate, not a bill: what you actually pay depends on your Claude plan, not on Hatch. Each run stops at a
limit. The terms say the rest in plain words: you own what you build. Say "read me the terms" any time, or read `plugins/hatch/data/TERMS.md`.

Two kinds of idea Hatch will not build, and will say so once, plainly and finally: anything designed to
physically hurt, threaten, stalk or harass people, and anything that sexualises or exploits children.

Maintainers: see `CLAUDE.md`.
