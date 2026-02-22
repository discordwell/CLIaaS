// ---- Types ----

export interface CustomField {
  id: string;
  name: string;
  key: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'date';
  required: boolean;
  options: string[];
  conditions: Record<string, unknown>;
  sortOrder: number;
  createdAt: string;
}

export interface CustomForm {
  id: string;
  name: string;
  fields: string[];
  ticketType: string;
  createdAt: string;
}

// ---- In-memory stores ----

const fields: CustomField[] = [];
const forms: CustomForm[] = [];
let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  fields.push(
    {
      id: 'cf-environment',
      name: 'Environment',
      key: 'environment',
      type: 'select',
      required: true,
      options: ['production', 'staging', 'development', 'local'],
      conditions: {},
      sortOrder: 1,
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    },
    {
      id: 'cf-browser',
      name: 'Browser',
      key: 'browser',
      type: 'text',
      required: false,
      options: [],
      conditions: {},
      sortOrder: 2,
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    },
    {
      id: 'cf-severity',
      name: 'Severity Level',
      key: 'severity_level',
      type: 'select',
      required: true,
      options: ['critical', 'major', 'minor', 'cosmetic'],
      conditions: {},
      sortOrder: 3,
      createdAt: new Date(Date.now() - 25 * 86400000).toISOString(),
    },
    {
      id: 'cf-regression',
      name: 'Is Regression',
      key: 'is_regression',
      type: 'checkbox',
      required: false,
      options: [],
      conditions: {},
      sortOrder: 4,
      createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    },
    {
      id: 'cf-due-date',
      name: 'Due Date',
      key: 'due_date',
      type: 'date',
      required: false,
      options: [],
      conditions: {},
      sortOrder: 5,
      createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
    }
  );

  forms.push({
    id: 'form-bug',
    name: 'Bug Report',
    fields: ['cf-environment', 'cf-browser', 'cf-severity', 'cf-regression'],
    ticketType: 'bug',
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  });
}

// ---- Fields API ----

export function listFields(): CustomField[] {
  ensureDefaults();
  return [...fields].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function createField(
  input: Omit<CustomField, 'id' | 'createdAt'>
): CustomField {
  ensureDefaults();
  const field: CustomField = {
    ...input,
    id: `cf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  fields.push(field);
  return field;
}

export function updateField(
  id: string,
  updates: Partial<Omit<CustomField, 'id' | 'createdAt'>>
): CustomField | null {
  ensureDefaults();
  const idx = fields.findIndex((f) => f.id === id);
  if (idx === -1) return null;
  fields[idx] = { ...fields[idx], ...updates };
  return fields[idx];
}

export function deleteField(id: string): boolean {
  ensureDefaults();
  const idx = fields.findIndex((f) => f.id === id);
  if (idx === -1) return false;
  fields.splice(idx, 1);
  return true;
}

// ---- Forms API ----

export function listForms(): CustomForm[] {
  ensureDefaults();
  return [...forms];
}

export function createForm(
  input: Omit<CustomForm, 'id' | 'createdAt'>
): CustomForm {
  ensureDefaults();
  const form: CustomForm = {
    ...input,
    id: `form-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  forms.push(form);
  return form;
}

export function deleteForm(id: string): boolean {
  ensureDefaults();
  const idx = forms.findIndex((f) => f.id === id);
  if (idx === -1) return false;
  forms.splice(idx, 1);
  return true;
}

// ---- Validation ----

export function validateFieldValue(
  field: CustomField,
  value: unknown
): { valid: boolean; error?: string } {
  if (field.required && (value === undefined || value === null || value === '')) {
    return { valid: false, error: `${field.name} is required` };
  }

  if (value === undefined || value === null || value === '') {
    return { valid: true };
  }

  switch (field.type) {
    case 'text':
      if (typeof value !== 'string') {
        return { valid: false, error: `${field.name} must be a string` };
      }
      break;
    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        return { valid: false, error: `${field.name} must be a number` };
      }
      break;
    case 'select':
      if (
        typeof value !== 'string' ||
        !field.options.includes(value)
      ) {
        return {
          valid: false,
          error: `${field.name} must be one of: ${field.options.join(', ')}`,
        };
      }
      break;
    case 'checkbox':
      if (typeof value !== 'boolean') {
        return { valid: false, error: `${field.name} must be a boolean` };
      }
      break;
    case 'date':
      if (typeof value !== 'string' || isNaN(Date.parse(value))) {
        return { valid: false, error: `${field.name} must be a valid date` };
      }
      break;
  }

  return { valid: true };
}
