WIREFRAME FEATURE ALIGNMENT SUMMARY
====================================
This document maps wireframe features to strategic context documents,
demonstrating alignment with the problems we're solving.

Reference Documents:
- context/strategy.md (Hypotheses and User Needs)
- wireframes/_index.md (Feature Matrix)

================================================================================
CONCEPT 1: PORTFOLIO DASHBOARD (Executive View)
================================================================================
File: wireframes/current/concept1_portfolio.excalidraw
      wireframes/current/Concept1_12_12_V1.png

Target Persona: Executive / Portfolio Owner
Example: D. Hazlehurst viewing Services Australia Portfolio

DISCOVER HYPOTHESIS ALIGNMENT
-----------------------------
The Discover hypothesis states: "Providing content creators and decision makers
with the ability to find government content within CA3 will allow them to more
quickly and easily find content fragments relevant to them."

Features supporting this:

1. AI-Assisted Search
   - Wireframe element: Search bar with "AI" badge
   - Strategy alignment: "A natural language search will provide a better
     interface with CA3 over traditional search methods"
   - User need: "An easier way for publishers to find published content
     across different government jurisdictions"

2. Platforms Overview
   - Wireframe elements: Platform list showing medicare, my.gov.au,
     healthsoftware.humanservices.gov.au, medicarestatus.humanservices.gov.au
   - Strategy alignment: Supports "Discover content and identify duplication
     using common topics"
   - Use case: "Assess availability, ownership, quality and/or popularity
     of content across a content domain"

3. Health Score Metrics (Data Visualization)
   - Wireframe elements: 4 metric cards (Platforms: 12, Health: 52%,
     SEO/AI: 68%, Content Overlap: 64%)
   - Strategy alignment: "Providing insights into content, particularly in
     a cross-site or end-to-end journey scenario, will enable website
     operators to make informed decisions"
   - Use case: "Monitor use of own content"

4. SEO/AI Status Panel
   - Wireframe elements: Google visibility 72%, AI accuracy 68%,
     Top query display
   - Strategy alignment: Supports "Research user experience with AI and search"
   - User question addressed: "How can I improve my website content?"

5. Performance Chart
   - Wireframe element: Health trend visualization placeholder
   - Strategy alignment: "Provide shared content analytics"

CONNECT HYPOTHESIS ALIGNMENT
----------------------------
The Connect hypothesis states: "Providing content creators and decision makers
with the ability to identify and connect with others across government will
streamline the content creation process."

Features supporting this:

1. Platform Owner Contacts
   - Wireframe elements: User avatars with "Contact" links
   - Strategy alignment: "Help people connect across government"
   - User need: "An easier way to find who owns published content"
   - User need: "The ability to directly connect with content owners"

2. Alerts & Notifications
   - Wireframe elements: "Notifications (3)" button, Alerts panel showing
     "3 platforms below health threshold", "Carer Payment content needs review"
   - Strategy alignment: "Visibility for content approvers in shared platforms"
   - Use case: "Monitor use of own content"

3. Share Report Action
   - Wireframe element: "Share report" button
   - Strategy alignment: "Shared platforms, tools, training, and forums
     for collaboration"

================================================================================
CONCEPT 2: PLATFORM DASHBOARD (Site Manager View)
================================================================================
File: wireframes/current/concept2_platform.excalidraw

Target Persona: Site Manager / Website Owner
Example: B. Hannan managing servicesaustralia.gov.au

DISCOVER HYPOTHESIS ALIGNMENT
-----------------------------
The Discover hypothesis states: "Providing content creators and decision makers
with the ability to find government content within CA3 will allow them to more
quickly and easily find content fragments relevant to them."

Features supporting this:

1. AI-Assisted Search
   - Wireframe element: Search bar with "AI" badge, placeholder text
     "Search topics & content... (AI assisted)"
   - Strategy alignment: "A natural language search will provide a better
     interface with CA3 over traditional search methods"
   - User need: "An easier way for publishers to find published content"

2. Topics View
   - Wireframe elements: Topics panel showing 4 topic rows with metrics:
     * "Caring for someone" (86 pages, Health: 92%, Overlap: 45% with dss.gov.au)
     * "Carer Payment" (42 pages, Health: 88%, High search volume)
     * "Carer Allowance" (38 pages, Health: 85%, Fragment available)
     * "Respite care" (24 pages, Health: 71%, Needs review)
   - Strategy alignment: "Discover content and identify duplication using
     common topics"
   - Use case: "Find content to inform own content delivery"

3. Platform Metrics Dashboard
   - Wireframe elements: 5 metric cards showing:
     * PAGES: 342
     * TOPICS: 8
     * HEALTH: 85%
     * SEO/AI: 78%
     * WATCHLIST: 5
   - Strategy alignment: "Providing insights into content... will enable
     website operators to make informed decisions"
   - User question addressed: "How can I improve my website content?"

4. Watchlist Panel
   - Wireframe elements: List of starred content items for monitoring
     (Carer Payment eligibility page, Getting support if you're caring...,
     Carer Supplement annual payment, Young Carer Bursary Program, Respite care)
   - Strategy alignment: "Monitor use of own content"
   - Use case: Track important content across the platform

5. Performance (Health) Chart
   - Wireframe element: Chart placeholder "[Chart: Topics by health]"
   - Strategy alignment: "Provide shared content analytics"

6. SEO/AI Status Footer
   - Wireframe element: Top queries display showing search volumes
     ("carer payment eligibility" 2.4k/mo, "carer allowance how much" 1.8k/mo,
     "respite care for carers" 890/mo)
   - Strategy alignment: "Research user experience with AI and search"

CONNECT HYPOTHESIS ALIGNMENT
----------------------------
The Connect hypothesis states: "Providing content creators and decision makers
with the ability to identify and connect with others across government will
streamline the content creation process."

Features supporting this:

1. Content Owner Contacts
   - Wireframe elements: Content Owners panel with user avatars and Contact links
     (User 1 | Carers Payment, User 2 | Medicare)
   - Strategy alignment: "Help people connect across government"
   - User need: "An easier way to find who owns published content"
   - User need: "The ability to directly connect with content owners"

2. Alerts & Notifications Panel
   - Wireframe elements: Alerts (2) button, panel showing:
     "! Respite care topic below 'health' threshold"
     "! New fragment available for Carer Allowance"
     "View all alerts"
   - Strategy alignment: "Visibility for content approvers in shared platforms"
   - Use case: "Monitor use of own content"

3. Portfolio View Link
   - Wireframe element: "Portfolio view" button linking to executive dashboard
   - Strategy alignment: "Shared platforms, tools... for collaboration"

4. Share Report Action
   - Wireframe element: "Share report" button
   - Strategy alignment: Supports cross-government collaboration

================================================================================
CONCEPT 3: TOPIC DASHBOARD (Topic Steward View)
================================================================================
File: wireframes/current/concept3_topic.excalidraw

Target Persona: Topic Steward / Content Authority
Example: Topic owner managing "Caring for someone" across 6 platforms

DISCOVER HYPOTHESIS ALIGNMENT
-----------------------------
Features supporting this:

1. AI-Assisted Search
   - Wireframe element: Search bar "Search topic content... (AI assisted)"
     with AI badge
   - Strategy alignment: "A natural language search will provide a better
     interface with CA3 over traditional search methods"

2. Cross-Platform Topic Metrics
   - Wireframe elements: 5 metric cards:
     * PLATFORMS: 6 using topic
     * FRAGMENTS: 8 active
     * SEO/AI STATUS: 76% visible
     * SUBSCRIBERS: 12 (View all)
     * HEALTH: 82%
   - Strategy alignment: "Discover content and identify duplication using
     common topics"
   - Use case: "Assess availability, ownership, quality and/or popularity
     of content across a content domain"

3. Fragment Management Panel
   - Wireframe elements: Fragments panel with "+ Add new" button, fragment list:
     * "Carer Payment eligibility" (Used by 6 platforms | Current)
     * Multiple fragments with checkboxes and "Add to page" links
   - Strategy alignment: "Find content to use on website"
   - Use case: "Find content to inform own content delivery"

4. Watchlist Action
   - Wireframe element: "+ Watchlist" button
   - Strategy alignment: "Monitor use of own content"

5. Compare Functionality
   - Wireframe element: "Compare" button for comparing content across platforms
   - Strategy alignment: "Discover content and identify duplication"

CONNECT HYPOTHESIS ALIGNMENT
----------------------------
Features supporting this:

1. Alerts & Notifications
   - Wireframe element: "Alerts (4)" button with notification count
   - Strategy alignment: "Visibility for content approvers in shared platforms"

2. Subscriber Management
   - Wireframe element: SUBSCRIBERS metric (12) with "View all" link
   - Strategy alignment: "Help people connect across government"
   - Use case: "Collaborate and co-design with content owners"

3. Fragment Sharing ("Add to page")
   - Wireframe element: "Add to page" action on each fragment
   - Strategy alignment: "Shared platforms, tools... for collaboration"
   - Use case: "Find content to use on website"

Supporting: concept3_create_fragment.excalidraw (Fragment creation flow)

================================================================================
CONCEPT 3A: CREATE FRAGMENT (Fragment Creation Flow)
================================================================================
File: wireframes/current/concept3_create_fragment.excalidraw

Target Persona: Topic Steward / Content Creator
Context: Form for creating new reusable content fragments

DISCOVER HYPOTHESIS ALIGNMENT
-----------------------------
Features supporting this:

1. Search Existing Fragments Panel
   - Wireframe elements: "Search Existing Fragments" section with search input,
     "Check if similar content already exists", similar fragments display:
     * "Carer support for students" - 72% match
     * "Young carer resources" - 58% match
   - Strategy alignment: "Discover content and identify duplication using
     common topics"
   - User need: "An easier way for publishers to find published content"

2. Divergence Check
   - Wireframe elements: "Divergence Check" panel showing
     "Found: 2 variations across platforms" with "Compare" link
   - Strategy alignment: "Providing insights into content, particularly in
     a cross-site... scenario"
   - Use case: "Assess availability, ownership, quality... of content"

3. Validation Panel
   - Wireframe elements: Validation checklist showing:
     * Fragment name is unique
     * Content meets minimum length
     * Plain language score: Grade 8
     * Accessibility check pending
     With "Run checks" button
   - User question addressed: "What content is above reading level [grade 7]?"
   - Strategy alignment: Quality assurance before publishing

4. Content Preview
   - Wireframe element: Preview panel with rendered content
   - Strategy alignment: Supports informed decision-making

CONNECT HYPOTHESIS ALIGNMENT
----------------------------
Features supporting this:

1. Subscriber Notification Settings
   - Wireframe elements: Settings checkbox "Notify subscribers when updated"
   - Strategy alignment: "Visibility for content approvers in shared platforms"

2. After Publishing Info
   - Wireframe elements: Panel showing:
     "8 subscribers will be notified | Fragment will be available on 6 platforms
     | Topic owner: Jane Wilson"
     With "Manage subscribers" link
   - Strategy alignment: "Help people connect across government"
   - Use case: "Collaborate and co-design with content owners"

3. Topic Owner Contact
   - Wireframe element: Topic owner name displayed (Jane Wilson)
   - User need: "An easier way to find who owns published content"

4. Approval Workflow Option
   - Wireframe element: Settings checkbox "Require approval before sites can modify"
   - Strategy alignment: "Visibility for content approvers in shared platforms"
   - User need: "Guidance to help steer conversations across departments"

================================================================================
CONCEPT 4: CONTENT DASHBOARD (Content Editor View)
================================================================================
File: wireframes/current/concept4_content.excalidraw

Target Persona: Content Editor / Publisher
Example: Editor working on specific content pages within a topic

DISCOVER HYPOTHESIS ALIGNMENT
-----------------------------
Features supporting this:

1. Content Health Metrics
   - Wireframe elements: 4 metric cards:
     * HEALTH: 88%
     * SEO/AI STATUS: 92%
     * VIEWS: 12.4k
     * SUBSCRIBERS: 8
   - Strategy alignment: "Providing insights into content... will enable
     website operators to make informed decisions"
   - User question addressed: "How can I improve my website content?"

2. Recent Changes Panel
   - Wireframe element: Change history showing edits, updates, and timestamps
   - Strategy alignment: "Monitor use of own content"
   - Use case: Track content evolution and identify outdated content

3. Performance (Health) Chart
   - Wireframe element: Health trend visualization
   - Strategy alignment: "Provide shared content analytics"

4. Fragment Actions (Copy/Update/Adapt)
   - Wireframe elements: "Fragments on this page" panel with action buttons:
     * Copy - Use fragment as-is
     * Update - Sync with latest version
     * Adapt - Create local variation
   - Strategy alignment: "Find content to use on website"
   - Use case: "Find content to inform own content delivery"

5. SEO/AI Status Panel
   - Wireframe elements: Detailed discoverability metrics:
     * Google position
     * AI accuracy
     * Top queries
   - Strategy alignment: "Research user experience with AI and search"

6. Draft Preview & Share
   - Wireframe elements: "Draft in progress" section with:
     * Preview button
     * Share draft button
     * Get feedback button
   - Use case: Quality review before publishing

7. Watchlist Action
   - Wireframe element: "+ Watchlist" button
   - Strategy alignment: "Monitor use of own content"

CONNECT HYPOTHESIS ALIGNMENT
----------------------------
Features supporting this:

1. Seek Feedback Panel
   - Wireframe element: "Seek Feedback / Find Subscribers" section
   - Strategy alignment: "Collaborate and co-design with content owners"
   - User need: "Guidance to help steer conversations across departments"

2. Topic Owner Contact
   - Wireframe element: Contact information for topic owner
   - Strategy alignment: "Help people connect across government"
   - User need: "The ability to directly connect with content owners"

3. Alert Subscribers Action
   - Wireframe element: "Alert subscribers to changes" button
   - Strategy alignment: "Visibility for content approvers in shared platforms"

4. Context Navigation (Breadcrumb)
   - Wireframe element: Hierarchy showing Portfolio > Platform > Topic > Content
   - Strategy alignment: Supports navigation to relevant stakeholders at each level

5. Share Report Action
   - Wireframe element: "Share report" button
   - Strategy alignment: "Shared platforms, tools... for collaboration"

6. Find Subscribers
   - Wireframe element: Functionality to discover who is subscribed to content
   - Use case: "Collaborate and co-design with content owners"

================================================================================
REQUIREMENTS MATRIX SUMMARY
================================================================================

Feature                  | C1 | C2 | C3 |C3A | C4 | Notes
------------------------|----|----|----|----|----|---------------------------------
Search, AI assisted      | Y  | Y  | Y  | Lib| -  | Progressive disclosure by role
Platforms/Topics view    | Y  | Y  | -  | -  | -  | Executive sees platforms
Watchlist               | -  | Y  | Y  | -  | Y  | Not needed at portfolio level
Data vis (health)       | Y  | Y  | Y  | -  | Y  | All levels need health insights
SEO/AI status           | Y  | Y  | Y  | -  | Y  | All levels need discoverability
Recent changes          | -  | -  | Y  | -  | Y  | Editors need change history
Fragment actions        | -  | -  | Y  | Y  | Y  | Topic/Content level only
Preview/Share drafts    | -  | -  | -  | Y  | Y  | Content editors only
Owner contacts          | Plat| Con| All| Top| FB | Appropriate level per role
Alerts                  | Y  | Y  | Y  | -  | Sub| All levels with role variation
Subscribers             | -  | -  | Y  | Y  | Y  | Topic stewards manage subscribers
Divergence detection    | -  | -  | -  | Y  | -  | Fragment creation only
Validation checks       | -  | -  | -  | Y  | -  | Quality assurance on creation
Similar content search  | -  | -  | -  | Y  | -  | Prevents duplication

Legend: Y=Yes, -=No, Lib=Library search, Plat=Platform owners, Con=Content owners,
        All=All levels, Top=Topic owner, FB=Feedback, Sub=Subscriber alerts

================================================================================
EXAMPLE USE CASES ADDRESSED
================================================================================

From strategy.md:

1. "Find content to inform own content delivery"
   -> Addressed by: AI Search, Platform/Topic views, SEO/AI status

2. "Find content to use on website"
   -> Addressed by: Fragment actions (Copy/Adapt), Search

3. "Monitor use of own content"
   -> Addressed by: Health metrics, Alerts, Subscribers

4. "Assess availability, ownership, quality and/or popularity of content"
   -> Addressed by: Health scores, SEO/AI metrics, Platform overview

5. "Collaborate and co-design with content owners"
   -> Addressed by: Contact links, Feedback requests, Alert subscribers

================================================================================
EXAMPLE USER QUESTIONS ANSWERED
================================================================================

From strategy.md:

1. "How can I improve my website content?"
   -> SEO/AI Status panel, Health metrics, Alerts

2. "What content is similar to [content domain SME]?"
   -> Content Overlap metric (64%), Platform/Topic views

3. "What content is above reading level [grade 7]?"
   -> Health score factors (implied in detailed view)
