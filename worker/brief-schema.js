/**
 * The build brief: the contract between the intake conversation and everything
 * downstream of it.
 *
 * This module is the single source of truth for three things that must never
 * drift apart:
 *
 *   BRIEF_SCHEMA      the JSON Schema handed to Claude as a strict tool schema
 *   validateBrief()   the same schema, enforced again on the way into D1
 *   FORM_FIELDS       the no-JavaScript form, generated from the same shape
 *
 * It is plain JavaScript with no dependencies so the Worker can import it
 * directly and the Astro component can import it at build time.
 *
 * Two rules govern the schema's shape:
 *
 *  1. Anthropic strict tool use requires `additionalProperties: false` and a
 *     `required` array naming every property. Optionality is therefore
 *     expressed as a nullable type, not by omission -- the model must emit the
 *     key and set it to null. The `obj`/`str`/`enum_` helpers below enforce
 *     that so it cannot be got wrong field by field.
 *  2. Every field must be answerable by a non-technical person in one sentence,
 *     or inferable by the model from what they said. A field nobody can answer
 *     is a field that arrives null forever and misleads whoever reads the brief.
 */

export const BRIEF_VERSION = 1;

/* ------------------------------------------------------------------ helpers */

const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** Nullable object: the model may leave a whole section unanswered. */
const nobj = (properties) => ({ ...obj(properties), type: ['object', 'null'] });

const str = (description, maxLength) => ({
  type: ['string', 'null'],
  description,
  ...(maxLength ? { maxLength } : {}),
});

const enum_ = (values, description) => ({
  type: ['string', 'null'],
  enum: [...values, null],
  description,
});

const bool = (description) => ({ type: ['boolean', 'null'], description });

const int = (description, minimum, maximum) => ({
  type: ['integer', 'null'],
  description,
  ...(minimum === undefined ? {} : { minimum }),
  ...(maximum === undefined ? {} : { maximum }),
});

const arr = (items, description) => ({ type: 'array', items, description });

/** Array of plain strings -- the shape used for every free-text list. */
const strs = (description) => arr({ type: 'string', maxLength: 300 }, description);

/* ---------------------------------------------------------------- vocabulary */

export const FIELD_TYPES = [
  'text', 'longtext', 'number', 'date', 'datetime', 'money', 'email', 'phone',
  'select', 'file', 'photo', 'bool', 'reference', 'signature', 'location',
];

export const TRIGGER_KINDS = [
  'manual', 'schedule', 'inbound-email', 'webhook', 'form-submit', 'record-change',
];

export const OUTPUT_KINDS = [
  'screen', 'pdf', 'email', 'sms', 'spreadsheet-row', 'csv', 'dashboard', 'api', 'print',
];

export const TOOL_PATTERNS = [
  'form-to-record', 'scheduled-report', 'inbox-triage', 'checklist-runner',
  'data-sync', 'calculator', 'roster-tracker', 'approval-flow', 'booking',
  'inventory-count', 'other',
];

/**
 * What we can currently connect to. The model is given this list and must set
 * `assessment.buildableWithCatalog: false` and name the gap in
 * `assessment.missingConnectors` rather than promise something we cannot do.
 *
 * `scopeRisk` is here rather than in a doc because it changes what we should
 * build. Google's *restricted* scopes (full Drive, Gmail read) drag in a
 * third-party CASA security assessment costing thousands and taking months.
 * Anything marked `restricted` needs a deliberate, funded decision -- see
 * docs/SETUP.md. Designing around the `basic` entries avoids it entirely.
 */
export const CONNECTOR_CATALOG = [
  { key: 'google-sheets', label: 'Google Sheets', scopeRisk: 'basic', note: 'via drive.file — user picks the sheet' },
  { key: 'google-calendar', label: 'Google Calendar', scopeRisk: 'sensitive' },
  { key: 'google-drive-file', label: 'Google Drive (files the user picks)', scopeRisk: 'basic' },
  { key: 'gmail-send', label: 'Gmail (send only)', scopeRisk: 'sensitive' },
  { key: 'gmail-read', label: 'Gmail (read mailbox)', scopeRisk: 'restricted' },
  { key: 'microsoft-excel', label: 'Excel / OneDrive', scopeRisk: 'basic' },
  { key: 'microsoft-outlook', label: 'Outlook mail and calendar', scopeRisk: 'sensitive' },
  { key: 'microsoft-teams', label: 'Microsoft Teams', scopeRisk: 'sensitive' },
  { key: 'slack', label: 'Slack', scopeRisk: 'basic' },
  { key: 'airtable', label: 'Airtable', scopeRisk: 'basic' },
  { key: 'notion', label: 'Notion', scopeRisk: 'basic' },
  { key: 'quickbooks', label: 'QuickBooks Online', scopeRisk: 'sensitive' },
  { key: 'stripe', label: 'Stripe', scopeRisk: 'basic' },
  { key: 'shopify', label: 'Shopify', scopeRisk: 'basic' },
  { key: 'hubspot', label: 'HubSpot', scopeRisk: 'basic' },
  { key: 'salesforce', label: 'Salesforce', scopeRisk: 'sensitive' },
  { key: 'twilio-sms', label: 'SMS (Twilio)', scopeRisk: 'basic' },
  { key: 'webhook', label: 'A webhook from any other system', scopeRisk: 'basic' },
  { key: 'inbound-email', label: 'Email sent to an address we give you', scopeRisk: 'basic' },
  { key: 'csv-upload', label: 'Spreadsheet or CSV upload', scopeRisk: 'basic' },
  { key: 'none', label: 'Nothing — this stands alone', scopeRisk: 'basic' },
];

export const CONNECTOR_KEYS = CONNECTOR_CATALOG.map((c) => c.key);

/**
 * What a visitor can say they already use, as pickable options rather than a
 * blank box.
 *
 * A blank box asking "what software do you already use?" is answered with one
 * word or not at all, and the one word is usually ambiguous ("Sheets" — Google
 * or Excel?). A list is faster to answer, gives comparable answers across
 * briefs, and jogs the memory: people forget they use Zapier until they see it.
 *
 * The first group is deliberately not software. Plenty of the work we are asked
 * to fix is done on paper, in an inbox, or in somebody's head, and a list that
 * offers no way to say that quietly tells those visitors they are in the wrong
 * place. "Nothing yet" is a first-class answer.
 *
 * These are labels, not connectors. CONNECTOR_CATALOG above says what we can
 * integrate with today and stays the authority on that; this list is broader on
 * purpose, because knowing somebody lives in Jobber matters even though we
 * cannot yet talk to it. FREE_TEXT_TOOL_FIELD catches the rest — the list will
 * never be complete and should not pretend to be.
 */
export const TOOL_CHOICE_GROUPS = [
  {
    label: 'How it is handled now',
    options: [
      'Spreadsheets',
      'Paper forms or notebooks',
      'A whiteboard or wall planner',
      'An email inbox',
      'Text messages',
      'Phone calls',
      'Someone remembers it',
      'Another app not listed here',
      'Nothing yet',
    ],
  },
  {
    label: 'Spreadsheets and documents',
    options: [
      'Google Sheets',
      'Microsoft Excel',
      'Google Docs',
      'Microsoft Word',
      'Apple Numbers or Pages',
      'Airtable',
      'Notion',
      'Smartsheet',
      'Coda',
    ],
  },
  {
    label: 'Email, chat and meetings',
    options: [
      'Gmail',
      'Outlook',
      'Microsoft Teams',
      'Slack',
      'WhatsApp',
      'Zoom',
      'Google Meet',
      'Discord',
    ],
  },
  {
    label: 'Calendars and booking',
    options: [
      'Google Calendar',
      'Outlook Calendar',
      'Calendly',
      'Acuity Scheduling',
      'Eventbrite',
    ],
  },
  {
    label: 'Money, invoicing and payments',
    options: [
      'QuickBooks',
      'Xero',
      'FreshBooks',
      'Wave',
      'Sage',
      'Stripe',
      'Square',
      'PayPal',
      'Venmo or Zelle',
      'Bill.com',
      'Expensify',
    ],
  },
  {
    label: 'Customers, donors and marketing',
    options: [
      'Salesforce',
      'HubSpot',
      'Zoho',
      'Pipedrive',
      'Mailchimp',
      'Constant Contact',
      'Bloomerang',
      'DonorPerfect',
      'Little Green Light',
      'Neon CRM',
      "Blackbaud or Raiser's Edge",
      'Givebutter',
    ],
  },
  {
    label: 'Files and storage',
    options: [
      'Google Drive',
      'OneDrive or SharePoint',
      'Dropbox',
      'Box',
      'iCloud',
    ],
  },
  {
    label: 'Work, projects and tickets',
    options: [
      'Asana',
      'Trello',
      'Monday.com',
      'ClickUp',
      'Basecamp',
      'Jira',
      'Todoist',
      'Zendesk',
      'Freshdesk',
    ],
  },
  {
    label: 'Forms and surveys',
    options: [
      'Google Forms',
      'Microsoft Forms',
      'Jotform',
      'Typeform',
      'SurveyMonkey',
      'Cognito Forms',
    ],
  },
  {
    label: 'Staff, shifts and field work',
    options: [
      'When I Work',
      'Deputy',
      'Homebase',
      'ServiceTitan',
      'Jobber',
      'Housecall Pro',
      'Fleetio',
    ],
  },
  {
    label: 'People and payroll',
    options: [
      'ADP',
      'Gusto',
      'Paychex',
      'Rippling',
      'BambooHR',
    ],
  },
  {
    label: 'Websites, stores and automation',
    options: [
      'WordPress',
      'Squarespace',
      'Wix',
      'Webflow',
      'Shopify',
      'Zapier',
      'Make',
      'Power Automate',
    ],
  },
];

/** Every pickable label, flat. Used to reject anything the form did not offer. */
export const TOOL_CHOICES = TOOL_CHOICE_GROUPS.flatMap((g) => g.options);


/* -------------------------------------------------------------- the schema */

export const BRIEF_SCHEMA = obj({
  briefVersion: { type: 'integer', enum: [BRIEF_VERSION], description: 'Always 1.' },
  source: enum_(['conversation', 'form'], 'How this brief was collected.'),

  contact: nobj({
    name: str('Their name.', 120),
    email: str('Their email address.', 200),
    organization: str('Organization, if they gave one.', 200),
    role: str('Their job or role.', 120),
    timezone: str('Rough timezone or region, if mentioned.', 80),
  }),

  problem: nobj({
    headline: str('One plain sentence naming the problem. No jargon, no solution.', 80),
    narrative: str('What happens today, in their own words.', 2000),
    todayWorkflow: str('The current process step by step, including the manual parts.', 1500),
    triggerEvent: str('Why they are asking now.', 400),
    painCost: nobj({
      unit: enum_(
        ['hours-per-week', 'dollars-per-month', 'errors-per-month', 'people-affected', 'unknown'],
        'How the cost of the problem is best measured.',
      ),
      value: int('The number, if they gave one.', 0),
      notes: str('Anything qualifying that number.', 400),
    }),
    frequency: enum_(
      ['continuous', 'daily', 'weekly', 'monthly', 'quarterly', 'ad-hoc', 'unknown'],
      'How often the problem occurs.',
    ),
    successCriteria: arr(
      obj({
        statement: { type: 'string', maxLength: 300, description: 'We will know it worked when…' },
        measurable: { type: 'boolean', description: 'True if this can be counted or timed.' },
      }),
      'How they will judge whether the tool worked.',
    ),
  }),

  users: nobj({
    primary: nobj({
      label: str('Who they are, e.g. "site foremen" or "volunteer coordinators".', 200),
      countEstimate: int('Roughly how many people.', 0),
      technicalComfort: enum_(['low', 'medium', 'high', 'unknown'], 'How comfortable they are with software.'),
      devices: arr({ type: 'string', enum: ['phone', 'tablet', 'desktop'] }, 'What they will use it on.'),
      accessibilityNeeds: strs('Any stated accessibility requirements.'),
    }),
    secondary: strs('Other groups who touch it — admins, approvers, viewers.'),
    authModel: enum_(
      ['single-user', 'team-shared', 'org-with-roles', 'public-anonymous', 'unknown'],
      'Who can sign in and how they are grouped.',
    ),
    roles: arr(
      obj({
        name: { type: 'string', maxLength: 80 },
        canDo: { type: 'array', items: { type: 'string', maxLength: 200 } },
      }),
      'Distinct roles and what each is allowed to do.',
    ),
    adminOwner: str('Who will administer it day to day.', 200),
  }),

  platform: nobj({
    target: enum_(['web', 'mobile-web', 'native-mobile', 'both', 'undecided'], 'Where it needs to run.'),
    offlineRequired: bool('True only if they will genuinely be without a signal.'),
    offlineReason: str('Why offline is needed, if it is.', 300),
    deviceCapabilities: arr(
      { type: 'string', enum: ['camera', 'gps', 'push', 'barcode', 'nfc', 'file-upload', 'signature', 'none'] },
      'Device features the job needs.',
    ),
    languages: strs('Languages it must be available in.'),
  }),

  systems: nobj({
    existing: arr(
      obj({
        vendor: { type: 'string', maxLength: 120, description: 'What they called it.' },
        catalogKey: { type: ['string', 'null'], enum: [...CONNECTOR_KEYS, null], description: 'Matching connector, or null if we have none.' },
        role: { type: 'string', enum: ['source', 'destination', 'both', 'reference'] },
        whoAdministers: { type: ['string', 'null'], maxLength: 200 },
        confidence: { type: 'string', enum: ['confirmed', 'assumed'], description: 'Assumed if we inferred it rather than being told.' },
      }),
      'The software they already use that this tool must work with.',
    ),
    spreadsheetsOrDocs: arr(
      obj({
        name: { type: 'string', maxLength: 200 },
        whereStored: { type: ['string', 'null'], maxLength: 200 },
        approxRows: { type: ['integer', 'null'], minimum: 0 },
      }),
      'Spreadsheets and documents currently holding the data.',
    ),
    onPaper: strs('Parts of the process still done on paper or in someone’s head.'),
    cannotChange: strs('Systems the tool must not disturb.'),
  }),

  data: nobj({
    entities: arr(
      obj({
        name: { type: 'string', maxLength: 80, description: 'Singular noun, e.g. "Inspection".' },
        approxVolume: { type: ['integer', 'null'], minimum: 0, description: 'Roughly how many exist or are created per month.' },
        fields: {
          type: 'array',
          items: obj({
            name: { type: 'string', maxLength: 80 },
            type: { type: 'string', enum: FIELD_TYPES },
            required: { type: 'boolean' },
            example: { type: ['string', 'null'], maxLength: 200, description: 'A realistic example. Never a real person’s data.' },
            options: { type: 'array', items: { type: 'string', maxLength: 120 }, description: 'Choices, for select fields.' },
          }),
        },
      }),
      'The things the tool keeps track of, and what is recorded about each.',
    ),
    sourceOfTruth: str('Which system wins when two disagree.', 300),
    retention: str('How long records must be kept, and why.', 300),
    sensitivity: nobj({
      pii: bool('Contains names, contact details or similar.'),
      phi: bool('Contains health information.'),
      financial: bool('Contains payment or bank detail.'),
      minors: bool('Concerns people under 18.'),
      notes: str('Anything else about sensitivity.', 400),
    }),
    residency: enum_(['us', 'eu', 'any', 'unknown'], 'Where the data must physically live.'),
  }),

  workflow: nobj({
    triggers: arr(
      obj({
        kind: { type: 'string', enum: TRIGGER_KINDS },
        detail: { type: 'string', maxLength: 400 },
        schedule: { type: ['string', 'null'], maxLength: 120, description: 'Plain English, e.g. "every Monday 8am".' },
      }),
      'What starts the process.',
    ),
    steps: arr(
      obj({
        order: { type: 'integer', minimum: 1 },
        actor: { type: 'string', enum: ['user', 'system'] },
        action: { type: 'string', maxLength: 400 },
        system: { type: ['string', 'null'], maxLength: 120 },
      }),
      'What the tool does, in order.',
    ),
    outputs: arr(
      obj({
        kind: { type: 'string', enum: OUTPUT_KINDS },
        detail: { type: 'string', maxLength: 400 },
        recipient: { type: ['string', 'null'], maxLength: 200 },
        frequency: { type: ['string', 'null'], maxLength: 120 },
      }),
      'What comes out, and who receives it.',
    ),
    notifications: arr(
      obj({
        to: { type: 'string', maxLength: 200 },
        when: { type: 'string', maxLength: 300 },
        channel: { type: 'string', enum: ['email', 'sms', 'push', 'slack', 'teams', 'in-app'] },
      }),
      'Who gets told what, and when.',
    ),
    approvalGates: strs('Anything that needs a human sign-off before it proceeds.'),
  }),

  integrations: arr(
    obj({
      catalogKey: { type: 'string', enum: CONNECTOR_KEYS },
      direction: { type: 'string', enum: ['read', 'write', 'both'] },
      whatFor: { type: 'string', maxLength: 300 },
      hasAdminConsent: {
        type: 'string',
        enum: ['yes', 'no', 'unknown'],
        description:
          'Whether their IT admin has already approved connecting third-party apps. Ask if it is a Microsoft or Google Workspace tenant — this decides whether "just sign in" is actually true for them.',
      },
    }),
    'Connections the tool needs, drawn from the catalog.',
  ),

  constraints: nobj({
    mustHave: strs('Non-negotiable requirements.'),
    niceToHave: strs('Wanted, but not for the first version.'),
    outOfScope: strs('Explicitly not wanted.'),
    compliance: arr(
      { type: 'string', enum: ['none', 'hipaa', 'ferpa', 'pci', 'gdpr', 'soc2-customer-requirement', 'unsure'] },
      'Regulatory regimes mentioned.',
    ),
    deadline: nobj({
      date: str('A date or month, if given.', 60),
      reason: str('What the date is tied to.', 300),
    }),
    budget: nobj({
      band: enum_(
        ['under-500', '500-2000', '2000-10000', 'over-10000', 'subscription-only', 'unsure'],
        'Rough budget band.',
      ),
      notes: str('Anything qualifying it.', 300),
    }),
    hostingPreference: enum_(['invicti-hosted', 'must-be-ours', 'no-preference'], 'Where it must run.'),
  }),

  assessment: nobj({
    fitScore: int('1 = we should decline, 5 = build this today.', 1, 5),
    suggestedPattern: enum_(TOOL_PATTERNS, 'The closest known shape for this tool.'),
    buildableWithCatalog: bool('False if it needs a connector we do not have.'),
    missingConnectors: strs('Systems it needs that are not in the catalog.'),
    estimatedComplexity: enum_(['trivial', 'small', 'medium', 'large'], 'Our read on the size of the build.'),
    openQuestions: strs('What a human still needs to ask.'),
    risks: strs('What could make this go wrong.'),
    suggestedShape: str('One paragraph: what we would actually build.', 1200),
  }),

  completeness: nobj({
    score: int('0-100. How much of this brief is answered well enough to build from.', 0, 100),
    missingRequired: strs('Named gaps still worth chasing.'),
    interviewComplete: bool(
      'True once you have asked everything worth asking and have told the visitor a human will be in touch. This is what ends the conversation, so set it deliberately, not optimistically.',
    ),
  }),

  consent: nobj({
    contactOk: bool('They expect us to reply by email.'),
    storeTranscriptOk: bool('They were told the conversation is stored.'),
  }),
});

/* ------------------------------------------------------------- the validator */

/**
 * Validate a value against the subset of JSON Schema used above: type (single
 * or union), enum, required, additionalProperties, maxLength, minimum, maximum,
 * items and properties.
 *
 * Hand-written rather than pulled from npm because it is fifty lines, it runs
 * on every request in a Worker, and a validator we own cannot surprise us with
 * a supply-chain update. It is used as a second gate: the model is already
 * constrained by strict tool use, but a brief that fails here is rejected and
 * logged rather than stored, so a schema change on either side shows up loudly.
 *
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateBrief(value, schema = BRIEF_SCHEMA) {
  const errors = [];
  walk(value, schema, '', errors);
  return { valid: errors.length === 0, errors };
}

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v === 'number' ? 'number' : typeof v;
};

function walk(value, schema, path, errors) {
  if (errors.length > 40) return; // Stop piling up once it is clearly wrong.

  const at = path || '(root)';
  const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = typeOf(value);

  // `integer` satisfies a `number` slot; nothing else widens.
  const typeOk = allowed.some((t) => t === actual || (t === 'number' && actual === 'integer'));
  if (schema.type && !typeOk) {
    errors.push(`${at}: expected ${allowed.join('|')}, got ${actual}`);
    return;
  }

  if (value === null) return;

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`);
  }

  if (actual === 'string') {
    if (schema.maxLength && value.length > schema.maxLength) {
      errors.push(`${at}: ${value.length} chars exceeds max ${schema.maxLength}`);
    }
    return;
  }

  if (actual === 'integer' || actual === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${at}: ${value} below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${at}: ${value} above maximum ${schema.maximum}`);
    }
    return;
  }

  if (actual === 'array') {
    if (schema.items) value.forEach((item, i) => walk(item, schema.items, `${at}[${i}]`, errors));
    return;
  }

  if (actual === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${at}: missing required property "${key}"`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) {
          errors.push(`${at}: unexpected property "${key}"`);
        }
        continue;
      }
      walk(child, childSchema, path ? `${path}.${key}` : key, errors);
    }
  }
}

/* ------------------------------------------------------- the no-JS fallback */

/**
 * The plain form shown when JavaScript is unavailable, when the model is, or
 * when the visitor simply prefers a form -- and there are plenty of those.
 *
 * A dozen fields, chosen because between them they answer enough of the schema
 * above for a human to pick up the phone. The Worker feeds these answers
 * through a single structuring call, and stores and emails them verbatim even
 * if that call fails. Nothing on this path depends on AI succeeding.
 */
/**
 * @typedef {object} FormField
 * @property {string} name
 * @property {string} label
 * @property {'text'|'email'|'textarea'|'select'|'checkbox'|'pills'} type
 * @property {boolean} required
 * @property {string} [hint]
 * @property {number} [rows]
 * @property {'name'|'email'|'organization'} [autocomplete]
 * @property {{value: string, label: string}[]} [options]
 * @property {{label: string, options: string[]}[]} [groups] Pills only: the
 *   choices, in labelled groups. The label is the value — there is no separate
 *   key, because these are read by a person and by the model, not joined to
 *   anything.
 */

/** @type {FormField[]} */
export const FORM_FIELDS = [
  { name: 'name', label: 'Your name', type: 'text', required: true, autocomplete: 'name' },
  { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' },
  { name: 'organization', label: 'Organization', type: 'text', required: false, autocomplete: 'organization' },
  {
    name: 'problem',
    label: 'What is going wrong?',
    hint: 'The thing that wastes your time or keeps going sideways. A few sentences is plenty.',
    type: 'textarea',
    rows: 5,
    required: true,
  },
  {
    name: 'today',
    label: 'How do you handle it today?',
    hint: 'Spreadsheets, paper, another app, or nothing yet.',
    type: 'textarea',
    rows: 3,
    required: true,
  },
  {
    name: 'tools',
    label: 'What do you already use for this?',
    hint: 'Pick as many as apply. Spreadsheets, paper, another app, or nothing yet — all fine answers.',
    type: 'pills',
    required: false,
    groups: TOOL_CHOICE_GROUPS,
  },
  {
    name: 'toolsOther',
    label: 'Anything else you use',
    hint: 'Whatever the list above missed, in your own words.',
    type: 'text',
    required: false,
  },
  {
    name: 'who',
    label: 'Who would use it, and roughly how many people?',
    type: 'text',
    required: false,
  },
  {
    name: 'platform',
    label: 'Where does it need to work?',
    type: 'select',
    required: false,
    options: [
      { value: '', label: '—' },
      { value: 'web', label: 'On a computer' },
      { value: 'mobile-web', label: 'On a phone' },
      { value: 'both', label: 'Both' },
      { value: 'undecided', label: 'Not sure' },
    ],
  },
  {
    name: 'timeline',
    label: 'When do you need it?',
    type: 'select',
    required: false,
    options: [
      { value: '', label: '—' },
      { value: 'exploring', label: 'Just exploring' },
      { value: '1month', label: 'Within a month' },
      { value: '3months', label: 'Within three months' },
      { value: 'deadline', label: 'I have a fixed deadline' },
    ],
  },
  {
    name: 'budget',
    label: 'Rough budget',
    hint: 'An honest range helps us tell you quickly whether we can help.',
    type: 'select',
    required: false,
    options: [
      { value: '', label: '—' },
      { value: 'under-500', label: 'Under $500' },
      { value: '500-2000', label: '$500 – $2,000' },
      { value: '2000-10000', label: '$2,000 – $10,000' },
      { value: 'over-10000', label: 'Over $10,000' },
      { value: 'subscription-only', label: 'Prefer a monthly subscription' },
      { value: 'unsure', label: 'Not sure yet' },
    ],
  },
  {
    name: 'consent',
    label: 'You may store what I send and email me back about it.',
    type: 'checkbox',
    required: true,
  },
];
