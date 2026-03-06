export type ViewConditionOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'less_than';

export interface ViewCondition {
  field: string;
  operator: ViewConditionOperator;
  value?: string;
}

export type ViewCombineMode = 'and' | 'or';

export interface ViewSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ViewQuery {
  conditions: ViewCondition[];
  combineMode: ViewCombineMode;
  sort?: ViewSort;
}

export type ViewType = 'system' | 'shared' | 'personal';

export interface View {
  id: string;
  name: string;
  description?: string;
  query: ViewQuery;
  viewType: ViewType;
  userId?: string;
  active: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}
