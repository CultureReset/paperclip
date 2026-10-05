OK, are they still the same?

Yes. The cleanest way to understand the whole thing is to follow one real business all the way through the system.

Use The Sandbar Grill as the example.

The important distinction is:

Paperclip knows:
"What does this company's NEXT GENT account have and what can it do?"
gcr-api-clean knows:
"What is The Sandbar Grill and what is true about the business?"
nextgent-platform knows:
"How do I actually perform this action on the owner's real devices?"
Boxes / Play-user / GCR / Plat-admin know:
"How should this information be presented to this particular person?"

That separation makes the whole thing understandable.

⸻

The complete business lifecycle

1. Matt creates a NEXT GENT account.
2. He creates or claims The Sandbar Grill.
3. NEXT GENT connects that Paperclip company to the Sandbar Grill business record.
4. Business information starts flowing into the business-data side.
5. The owner installs Apps, Agents and Automations from the Store.
6. If the business has the local computer/Android setup, it gets paired to the same account.
7. The owner uses Play-user, mobile or Boxes; all of them see the same company.
8. Jarvis and the other agents work through Paperclip and the business-data/tools available to that company.
9. Anything requiring a real-world action can go through nextgent-platform → Android/browser/Linux → verification → receipt.
10. The public business page, GCR directory and concierge read the same live business data, while Plat-admin lets you operate the whole fleet/platform.

Now I’ll break down what actually happens inside each step.

⸻

1. Customer signs up

The owner opens NEXT GENT.

NEXT GENT
    ↓
Create account
    ↓
email / password
    ↓
Paperclip

Paperclip owns:

user
account
company/workspace
membership

So:

Matt
  ↓
NEXT GENT account
  ↓
Company
"The Sandbar Grill"

At this point Paperclip doesn’t need to know the restaurant’s menu, happy hour or live music.

It only knows:

Matt has access to this company.

⸻

2. Find or create the actual business

Next comes:

Find your business

The owner searches:

Sandbar Grill

That search belongs to the business-data side.

Conceptually:

Play-user
     ↓
business search
     ↓
gcr-api-clean
     ↓
Business DB

Maybe The Sandbar Grill already exists in Gulf Coast Radar.

Then NEXT GENT says:

The Sandbar Grill
Orange Beach, Alabama
[Use this business]

If it doesn’t exist:

[Create new business]

Now you establish the important mapping:

Paperclip company_id
        ↕
Business business_id / slug

For example:

Paperclip
company_id = c_78291
Business DB
business_id = 445
slug = sandbar-grill

That relationship is what allows one NEXT GENT account to have platform capabilities while still using the existing structured business database.

⸻

3. Business information

Now the owner is not filling out some giant hard-coded restaurant application.

The business side discovers what information applies.

The Sandbar might have:

Identity
Hours
Contact
Location
Photos
Menu
Happy Hour
Live Music
Events
Services
Reservations
Policies
Reviews
Social Links

Another company might have:

Boats
Captains
Trips
Species
Pickup Locations
Availability
Pricing
Waivers

Same engine.

Different data.

That’s the modular part.

⸻

4. Connect existing data sources

Now onboarding asks what the owner already uses.

For example:

Google Business
Yelp
FareHarbor
Google Calendar
Outlook Calendar
forwarded email
Venmo
Cash App

Those connections feed business information.

Example:

A FareHarbor email comes in:

New booking
6 people
October 8
2:00 PM

Your parser extracts it.

Then:

email
   ↓
parser
   ↓
booking
   ↓
gcr-api-clean
   ↓
business data

Same with an iCal calendar:

Google / Airbnb / FareHarbor calendar
          ↓
       import
          ↓
     occupancy
          ↓
    availability

The owner doesn’t have to manually enter everything.

⸻

5. The owner’s Business page

Now Play-user can show:

Business

It isn’t storing another copy of all of this.

It displays business data.

Example:

The Sandbar Grill
Overview
Info
Hours
Menu
Events
Photos
Services
Staff
Policies
Reviews
Integrations

Those sections come from the business-data system.

So if Matt changes:

Friday closing time
2 AM → 1 AM

the path should be:

Play-user
    ↓
business bridge/API
    ↓
gcr-api-clean
    ↓
Business DB

Now the structured fact has changed.

Anything else reading that fact gets the new value.

⸻

6. Store

Now the owner wants capabilities.

They open:

Store

The customer sees something simple:

Apps
Agents
Automations

Underneath, Paperclip handles the install lifecycle.

Example store:

QR Menu
Real-Time Availability
Song Requests
Review Manager
Booking Agent
Social Media Agent
Review After Booking

⸻

7. Installing an App

Let’s install:

Real-Time Availability

The owner clicks it.

The store details can say:

Needs:
Business information
Availability
Bookings
Does not need:
Payments
Messages
Contacts
Public surface:
Optional

Then:

Install

Paperclip records:

company
item
version
update channel
automatic/manual updates

Something like:

Sandbar Grill
Real-Time Availability
v1.4
stable
automatic

That is platform state.

⸻

8. What an App actually is

This is where your system is different.

Real-Time Availability does not necessarily become another entire server.

It can be a manifest/definition interpreted by a shared runtime.

Something like conceptually:

Real-Time Availability
owner surface:
show availability editor
public surface:
show available times
data:
availability
capacity
bookings
actions:
search
update
explain

Then the same app has multiple faces.

Owner face

Inside Play-user:

Availability
Today
5 PM     AVAILABLE
6 PM     FULL
7 PM     4 seats
8 PM     AVAILABLE

Public face

On the public Sandbar page:

Available tonight
5:00 PM
7:00 PM - 4 seats
8:00 PM

Agent face

Booking Agent can ask:

availability.search

All three are the same underlying capability.

Not three apps.

⸻

9. Installing an Agent

Now Sandbar installs:

Booking Agent

Paperclip creates/manages the actual agent.

Conceptually:

Booking Agent
Role
Bookings
Worker
Hermes
Tools
business data
availability
calendar
Permissions
read availability
read bookings
possibly create booking

Paperclip remains the boss.

Hermes is the worker.

Paperclip
    ↓
Booking Agent
    ↓
Hermes

If someday you replace Hermes:

Paperclip
    ↓
different worker

The customer doesn’t care.

They still see:

Booking Agent

⸻

10. Jarvis

Jarvis is different.

Jarvis is the owner’s general conversational doorway.

The owner says:

Jarvis, do I have anything open Saturday night?

Jarvis needs facts.

So:

Owner
   ↓
Jarvis
   ↓
business-data tool
   ↓
gcr-api-clean
   ↓
availability
   ↓
Jarvis

Answer:

You have openings at 5:30, 7:00 and 8:30.

No Android required because that’s just reading data.

⸻

11. Jarvis delegating work

Now the owner says:

Have the Booking Agent check tomorrow’s schedule and tell me whether I can take another party of eight.

The path becomes:

Owner
  ↓
Jarvis
  ↓
Paperclip task
  ↓
Booking Agent
  ↓
Hermes
  ↓
availability/business tools
  ↓
gcr-api-clean
  ↓
result
  ↓
Paperclip
  ↓
Jarvis

Paperclip retains the work record.

Not Hermes Kanban plus Paperclip Kanban.

One boss:

Paperclip

⸻

12. Automations

Now Matt installs:

Review After Booking

It is primarily a definition.

WHEN
booking completed
WAIT
24 hours
DO
send review request
USING
Review Agent

Paperclip stores/runs the routine.

The Review Agent handles the task.

If sending the review is through some normal API/email integration:

Paperclip
   ↓
Review Agent
   ↓
tool

If it needs the owner’s actual phone:

Paperclip / agent
       ↓
device capability
       ↓
nextgent-platform
       ↓
physical Android

Different execution path.

Same automation.

⸻

13. Local computer

Now The Sandbar Grill has its NEXT GENT computer.

That machine runs the local blocks.

Conceptually:

Sandbar computer
│
├── Boxes
├── Jarvis
├── nextgent-platform
├── nextgent-maps
├── browser sessions
└── worker/local services

The owner sees it in Play-user:

Computer
Online
Sandbar Grill
Android connected
Internet connected
SIM active
Voice ready
[Open Computer]

The machine itself knows:

I belong to The Sandbar Grill.

Paperclip knows:

This device belongs to this company.

The existing relay provides remote communication with it.

⸻

14. Boxes

Boxes is what people see on the local screen/TV.

NEXT GENT
Home
Calendar
Apps
Agents
Messages
Files
Android
Settings
Ask NEXT GENT anything...

Boxes is not another boss.

It is a surface.

For a read:

What bookings are tonight?

Boxes
  ↓
business capability
  ↓
platform/business API
  ↓
bookings

For an action:

Text tonight’s entertainer and confirm 7 PM.

Boxes does not directly do whatever it wants.

Boxes
  ↓
core / nextgent-platform
  ↓
policy

Then:

ALLOW
ASK
DENY

⸻

15. Physical Android

Suppose the task is:

Update our Facebook hours.

There might not be an API you want to use.

So NEXT GENT uses the customer’s actual phone.

Owner request
     ↓
Jarvis / task
     ↓
capability
facebook.update_hours
     ↓
nextgent-platform
     ↓
policy
     ↓
Facebook App Map
     ↓
androidd
     ↓
physical Android
     ↓
Facebook app

The Map tells the executor the known procedure.

Something like:

Open Facebook
→ business profile
→ edit details
→ hours
→ Friday
→ change time
→ save

The executor observes the actual UI.

⸻

16. Approval

Maybe the policy says changing a public business listing requires confirmation.

Then:

ASK

The owner’s physical number receives:

Update Sandbar Grill Friday hours to 1 AM? Reply YES 4821.

Owner sends:

YES 4821

That releases exactly that pending action.

Not unlimited permission.

⸻

17. Verification

This is important.

The system does not stop at:

I tapped Save.

After acting:

nextgent-platform
       ↓
fresh observation
       ↓
verify expected state

For example:

Facebook now shows:
Friday
11 AM – 1 AM

Then:

VERIFIED

If verification fails:

NOT VERIFIED

It shouldn’t pretend success.

⸻

18. Receipt

Once it is verified:

Receipt
Requested by:
Matt
Action:
Update Facebook hours
Business:
The Sandbar Grill
Old:
Friday closes 2 AM
New:
Friday closes 1 AM
Executor:
Android
Verified:
Yes
Time:
10:42 PM

That receipt goes into Activity.

So Play-user can show:

Activity

Boxes can show recent activity.

Plat-admin can inspect failures.

And Paperclip can attach actions back to tasks/work.

⸻

19. App Maps and updates

Tomorrow Facebook moves the Hours button.

Your whole system should not break permanently.

You update:

Facebook Map 1.4
        ↓
Facebook Map 1.5

Then distribute the new Map.

The execution engine stays the same.

That’s exactly why Maps are separate.

⸻

20. System update

Different example:

You improve:

nextgent-platform

That’s software, not a Map.

Then your appliance update system handles it.

signed release
      ↓
Sandbar computer
      ↓
download changed block
      ↓
install
      ↓
health check

If healthy:

promote

If broken:

rollback

The customer does not manually rebuild their computer.

That’s the Red Hat side of the model.

⸻

21. Public business page

Meanwhile consumers see:

The Sandbar Grill

on a public page.

Base business information comes from:

gcr-api-clean

Installed apps can add blocks:

Menu
Live availability
Song requests
Live music
Reviews
Book a table

So conceptually:

PUBLIC BUSINESS PAGE
Business identity
       │
       ├── QR Menu app
       ├── Availability app
       ├── Song Request app
       ├── Reviews app
       └── Booking app

The owner chooses what is public.

⸻

22. GCR Directory

GCR is the larger consumer discovery layer.

Someone searches:

Waterfront restaurants open tonight with live music

GCR can use structured facts:

hours
location
live music
category
availability

and return:

The Sandbar Grill
Open tonight
Live music at 7
Table availability at 5:30 and 8:00

That is much richer than an ordinary static directory.

⸻

23. Concierge

Now someone calls or texts the consumer number:

I need somewhere waterfront for six around 7 PM with live music.

The concierge path is roughly:

Consumer
   ↓
NEXT GENT concierge
   ↓
intent
   ↓
business-data search
   ↓
gcr-api-clean
   ↓
availability + facts
   ↓
rank/filter
   ↓
real options

Then:

Sandbar Grill
7:15 available
Live music
Waterfront

And the consumer can receive a custom result page.

The concierge does not need to ask each restaurant’s agent every time if the information is already structured.

⸻

24. Business-within-business

Now suppose the business isn’t simple.

Example:

The Wharf

Inside:

The Wharf
│
├── Marina
│   ├── Fishing Charter Company
│   │   ├── Boat A
│   │   └── Boat B
│   │
│   └── Boat Rental Company
│
├── Restaurant
├── Amphitheater
└── Stores

The parent-child relationship handles this.

Each child can have:

business data
apps
agents
automations
availability
public page

But users can navigate upward and downward.

So someone might ask:

What’s available at The Wharf tomorrow?

And NEXT GENT can query the children.

⸻

25. Plat-admin

Now switch from the business owner’s perspective to yours.

You sign into:

Plat-admin

You should eventually see things like:

Customers
Companies
Users
Agents
Apps
Automations
Store
Devices
Executions
Approvals
Business Data
System

You can inspect:

The Sandbar Grill

and see:

Paperclip company
business-data link
computer
Android
installed apps
installed agents
automations
recent tasks
recent executions
receipts
software versions
health

But that doesn’t mean Plat-admin stores everything.

It aggregates the appropriate systems.

⸻

26. The flow of a simple business edit

Owner changes menu price:

Cheeseburger $14 → $15.

Play-user
    ↓
Business
    ↓
gcr-api-clean
    ↓
Business DB

Then automatically:

Owner dashboard     sees $15
Public page         sees $15
GCR                 sees $15
QR Menu             sees $15
Business MCP        answers $15
Agent               answers $15
Concierge           answers $15

That’s your:

Single update → updates everywhere

concept.

No Android required.

⸻

27. The flow of an external-platform action

Owner says:

Update Google Business with today’s special.

Owner
 ↓
Jarvis
 ↓
intent
 ↓
Paperclip/task if appropriate
 ↓
capability request
 ↓
nextgent-platform
 ↓
policy
 ↓
Google Business App Map
 ↓
physical Android
 ↓
perform
 ↓
observe again
 ↓
verify
 ↓
receipt
 ↓
Paperclip Activity

Completely different execution path.

Same user experience.

⸻

28. The flow of an agent doing work

Owner says:

Have Social Media Agent make a post about tonight’s band.

Owner
 ↓
Jarvis
 ↓
Paperclip
 ↓
Social Media Agent
 ↓
business data
band = Coastal Road
time = 7 PM
location = Sandbar Grill

Agent prepares:

Coastal Road hits the stage tonight at 7…

If publishing requires approval:

Draft
 ↓
Approval
 ↓
YES

Then:

nextgent-platform
 ↓
Instagram/Facebook Map
 ↓
physical Android
 ↓
publish
 ↓
verify
 ↓
receipt

That’s a complete end-to-end agent flow.

⸻

29. The flow of an automation

Booking completes:

FareHarbor/email/calendar
        ↓
booking marked complete
        ↓
Paperclip routine
        ↓
WAIT 24 hours
        ↓
Review Agent
        ↓
compose request
        ↓
message capability
        ↓
SMS/email/phone
        ↓
receipt/activity

The automation itself is just data describing that sequence.

⸻

30. What every major piece does

This is the whole thing compressed:

PAPERCLIP
Who owns what?
What is installed?
Which agents exist?
Which automation runs?
What work is happening?
What needs approval?
GCR-API-CLEAN
What is true about the business?
Hours?
Menu?
Prices?
Availability?
Bookings?
Reviews?
Events?
APP RUNTIME
How should an installed app render and behave?
WORKERS
Who thinks/works?
Hermes
OpenClaw
Codex
etc.
JARVIS
Who does the owner talk to?
NEXTGENT-PLATFORM
How do we safely perform a real action?
APP MAPS
How do we operate known external applications?
ANDROID
Where do authenticated app actions actually happen?
BOXES
What does the local owner see?
PLAY-USER
What does the remote/mobile owner see?
GCR
What does the public see?
PLAT-ADMIN
What do you see as platform operator?
GHOST IMAGE / INSTALLER
How does the physical system install, update,
health-check and roll back?

And the overarching flow is really:

                         PERSON
                           │
             ┌─────────────┼──────────────┐
             │             │              │
         Play-user       Boxes          Public
             │             │              │
             └───────┬─────┘              │
                     ▼                    │
                 PAPERCLIP                │
          control / work / installs       │
               │          │               │
        ┌──────┘          └──────┐        │
        ▼                        ▼        │
  BUSINESS DATA               WORKERS     │
  gcr-api-clean                Agents     │
        │                        │        │
        │                        ▼        │
        │                 REAL-WORLD ACTION
        │                        │
        │                nextgent-platform
        │                        │
        │                   App Maps
        │                        │
        │                    Android
        │                        │
        │                   Verification
        │                        │
        │                     Receipt
        │
        └────────────────────────────────►
                     GCR / PUBLIC

That is the full business flow: one company identity, one business-data identity, multiple surfaces, modular capabilities, replaceable workers, a deterministic execution layer, and one live body of business information underneath everything.