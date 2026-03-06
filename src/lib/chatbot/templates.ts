/**
 * Pre-built chatbot flow templates with strong default prompts.
 * Each template creates a complete flow with positioned nodes.
 */

import type { ChatbotFlow, ChatbotNode } from './types';

export interface ChatbotTemplate {
  key: string;
  name: string;
  description: string;
  icon: string;
  createFlow: (id: string) => ChatbotFlow;
}

function node(
  id: string,
  type: ChatbotNode['type'],
  data: ChatbotNode['data'],
  position: { x: number; y: number },
  children?: string[],
): ChatbotNode {
  return { id, type, data, position, children };
}

export const CHATBOT_TEMPLATES: ChatbotTemplate[] = [
  {
    key: 'support_triage',
    name: 'Support Triage',
    description: 'Greet, collect info, check KB, and route to the right team.',
    icon: 'S',
    createFlow: (id) => {
      const nodes: Record<string, ChatbotNode> = {
        greeting: node('greeting', 'message', {
          text: "Hello! I'm here to help. Let me get a few details so I can assist you as quickly as possible.",
        }, { x: 300, y: 0 }, ['collect_name']),
        collect_name: node('collect_name', 'collect_input', {
          prompt: "What's your name?",
          variable: 'name',
          validation: 'none',
        }, { x: 300, y: 120 }, ['collect_email']),
        collect_email: node('collect_email', 'collect_input', {
          prompt: "And your email address?",
          variable: 'email',
          validation: 'email',
          errorMessage: "That doesn't look like a valid email. Could you try again?",
        }, { x: 300, y: 240 }, ['urgency_buttons']),
        urgency_buttons: node('urgency_buttons', 'buttons', {
          text: "Thanks, {{name}}! What best describes your issue?",
          options: [
            { label: 'Account locked / Can\'t login', nextNodeId: 'urgent_msg' },
            { label: 'Billing question', nextNodeId: 'billing_articles' },
            { label: 'How-to / Feature question', nextNodeId: 'kb_search' },
            { label: 'Something else', nextNodeId: 'handoff_general' },
          ],
        }, { x: 300, y: 360 }),
        urgent_msg: node('urgent_msg', 'message', {
          text: "I understand this is urgent. Let me connect you with a specialist right away.",
        }, { x: 0, y: 500 }, ['tag_urgent']),
        tag_urgent: node('tag_urgent', 'action', {
          actionType: 'set_tag',
          value: 'urgent',
        }, { x: 0, y: 620 }, ['handoff_urgent']),
        handoff_urgent: node('handoff_urgent', 'handoff', {
          message: "Connecting you to our account recovery team now. They'll have you back in your account shortly.",
        }, { x: 0, y: 740 }),
        billing_articles: node('billing_articles', 'article_suggest', {
          query: 'billing payment invoice',
          maxArticles: 3,
          noResultsNodeId: 'handoff_billing',
        }, { x: 250, y: 500 }, ['billing_helpful']),
        billing_helpful: node('billing_helpful', 'buttons', {
          text: "Did any of these articles answer your question?",
          options: [
            { label: 'Yes, thank you!', nextNodeId: 'close_resolved' },
            { label: 'No, I need more help', nextNodeId: 'handoff_billing' },
          ],
        }, { x: 250, y: 620 }),
        handoff_billing: node('handoff_billing', 'handoff', {
          message: "Let me connect you with our billing team. They can look into your account details directly.",
        }, { x: 250, y: 740 }),
        kb_search: node('kb_search', 'article_suggest', {
          maxArticles: 5,
          noResultsNodeId: 'handoff_general',
        }, { x: 500, y: 500 }, ['kb_helpful']),
        kb_helpful: node('kb_helpful', 'buttons', {
          text: "I found some articles that might help. Did these resolve your question?",
          options: [
            { label: 'Yes, all set!', nextNodeId: 'close_resolved' },
            { label: 'Not quite', nextNodeId: 'handoff_general' },
          ],
        }, { x: 500, y: 620 }),
        handoff_general: node('handoff_general', 'handoff', {
          message: "I'll connect you with a support agent who can help with this. Your info has been forwarded so you won't need to repeat yourself.",
        }, { x: 700, y: 500 }),
        close_resolved: node('close_resolved', 'message', {
          text: "Great! Glad I could help. If you need anything else, just start a new chat. Have a wonderful day!",
        }, { x: 400, y: 860 }, ['close_action']),
        close_action: node('close_action', 'action', {
          actionType: 'close',
        }, { x: 400, y: 980 }),
      };
      return {
        id,
        name: 'Support Triage',
        nodes,
        rootNodeId: 'greeting',
        enabled: false,
        version: 1,
        status: 'draft',
        description: 'Greet customers, collect contact info, search KB, and route to the right team.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
  },
  {
    key: 'faq_bot',
    name: 'FAQ Bot',
    description: 'Category-based FAQ with article suggestions and feedback loop.',
    icon: 'F',
    createFlow: (id) => {
      const nodes: Record<string, ChatbotNode> = {
        greeting: node('greeting', 'message', {
          text: "Hi there! I can help you find answers to common questions. What topic are you looking for help with?",
        }, { x: 300, y: 0 }, ['categories']),
        categories: node('categories', 'buttons', {
          text: "Select a category:",
          options: [
            { label: 'Getting Started', nextNodeId: 'articles_started' },
            { label: 'Account & Billing', nextNodeId: 'articles_billing' },
            { label: 'Troubleshooting', nextNodeId: 'articles_trouble' },
            { label: 'Other', nextNodeId: 'ask_question' },
          ],
        }, { x: 300, y: 120 }),
        articles_started: node('articles_started', 'article_suggest', {
          query: 'getting started setup onboarding',
          maxArticles: 5,
          noResultsNodeId: 'ask_question',
        }, { x: 0, y: 280 }, ['satisfaction']),
        articles_billing: node('articles_billing', 'article_suggest', {
          query: 'billing payment subscription pricing',
          maxArticles: 5,
          noResultsNodeId: 'ask_question',
        }, { x: 300, y: 280 }, ['satisfaction']),
        articles_trouble: node('articles_trouble', 'article_suggest', {
          query: 'troubleshoot error fix problem',
          maxArticles: 5,
          noResultsNodeId: 'ask_question',
        }, { x: 600, y: 280 }, ['satisfaction']),
        ask_question: node('ask_question', 'collect_input', {
          prompt: "No problem! Describe your question and I'll search for relevant articles:",
          variable: 'question',
          validation: 'none',
        }, { x: 600, y: 420 }, ['search_custom']),
        search_custom: node('search_custom', 'article_suggest', {
          maxArticles: 5,
          noResultsNodeId: 'handoff',
        }, { x: 600, y: 540 }, ['satisfaction']),
        satisfaction: node('satisfaction', 'buttons', {
          text: "Did this help answer your question?",
          options: [
            { label: 'Yes, perfect!', nextNodeId: 'close_happy' },
            { label: 'Partially', nextNodeId: 'ask_question' },
            { label: 'No, I need an agent', nextNodeId: 'handoff' },
          ],
        }, { x: 300, y: 500 }),
        close_happy: node('close_happy', 'message', {
          text: "Wonderful! Happy I could help. Feel free to come back anytime!",
        }, { x: 100, y: 660 }, ['close_action']),
        close_action: node('close_action', 'action', {
          actionType: 'close',
        }, { x: 100, y: 780 }),
        handoff: node('handoff', 'handoff', {
          message: "Let me connect you with a team member who can help with this directly.",
        }, { x: 500, y: 660 }),
      };
      return {
        id,
        name: 'FAQ Bot',
        nodes,
        rootNodeId: 'greeting',
        enabled: false,
        version: 1,
        status: 'draft',
        description: 'Category-based FAQ with article suggestions and feedback loop.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
  },
  {
    key: 'sales_router',
    name: 'Sales Router',
    description: 'Qualify leads, collect company info, and route to the right sales rep.',
    icon: 'R',
    createFlow: (id) => {
      const nodes: Record<string, ChatbotNode> = {
        greeting: node('greeting', 'message', {
          text: "Welcome! I'd love to learn about your needs so I can connect you with the right person on our team.",
        }, { x: 300, y: 0 }, ['collect_company']),
        collect_company: node('collect_company', 'collect_input', {
          prompt: "What company are you with?",
          variable: 'company',
          validation: 'none',
        }, { x: 300, y: 120 }, ['collect_role']),
        collect_role: node('collect_role', 'collect_input', {
          prompt: "And what's your role there?",
          variable: 'role',
          validation: 'none',
        }, { x: 300, y: 240 }, ['size_buttons']),
        size_buttons: node('size_buttons', 'buttons', {
          text: "How large is your team?",
          options: [
            { label: '1-10 people', nextNodeId: 'interest_small' },
            { label: '11-50 people', nextNodeId: 'interest_mid' },
            { label: '50+ people', nextNodeId: 'interest_enterprise' },
          ],
        }, { x: 300, y: 360 }),
        interest_small: node('interest_small', 'buttons', {
          text: "Great! Which product area interests you most?",
          options: [
            { label: 'Help Desk', nextNodeId: 'tag_helpdesk' },
            { label: 'Live Chat', nextNodeId: 'tag_chat' },
            { label: 'Knowledge Base', nextNodeId: 'tag_kb' },
          ],
        }, { x: 0, y: 500 }),
        interest_mid: node('interest_mid', 'buttons', {
          text: "Which solution are you evaluating?",
          options: [
            { label: 'Help Desk', nextNodeId: 'tag_helpdesk' },
            { label: 'Live Chat', nextNodeId: 'tag_chat' },
            { label: 'Full Suite', nextNodeId: 'tag_suite' },
          ],
        }, { x: 300, y: 500 }),
        interest_enterprise: node('interest_enterprise', 'message', {
          text: "Fantastic! For teams your size, I'll connect you directly with an enterprise specialist.",
        }, { x: 600, y: 500 }, ['tag_enterprise']),
        tag_helpdesk: node('tag_helpdesk', 'action', {
          actionType: 'set_tag',
          value: 'interest:helpdesk',
        }, { x: 0, y: 640 }, ['handoff_sales']),
        tag_chat: node('tag_chat', 'action', {
          actionType: 'set_tag',
          value: 'interest:chat',
        }, { x: 200, y: 640 }, ['handoff_sales']),
        tag_kb: node('tag_kb', 'action', {
          actionType: 'set_tag',
          value: 'interest:kb',
        }, { x: 0, y: 760 }, ['handoff_sales']),
        tag_suite: node('tag_suite', 'action', {
          actionType: 'set_tag',
          value: 'interest:suite',
        }, { x: 400, y: 640 }, ['handoff_sales']),
        tag_enterprise: node('tag_enterprise', 'action', {
          actionType: 'set_tag',
          value: 'segment:enterprise',
        }, { x: 600, y: 640 }, ['handoff_enterprise']),
        handoff_sales: node('handoff_sales', 'handoff', {
          message: "Perfect! I'm connecting you with a sales specialist who can walk you through a demo. They'll have your details ready.",
        }, { x: 200, y: 880 }),
        handoff_enterprise: node('handoff_enterprise', 'handoff', {
          message: "Connecting you with our enterprise team now. They specialize in solutions for larger organizations.",
        }, { x: 600, y: 760 }),
      };
      return {
        id,
        name: 'Sales Router',
        nodes,
        rootNodeId: 'greeting',
        enabled: false,
        version: 1,
        status: 'draft',
        description: 'Qualify leads, collect company info, and route to the right sales rep.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
  },
  {
    key: 'lead_qualifier',
    name: 'Lead Qualifier',
    description: 'Collect lead info, AI-qualify, enrich via webhook, then hand off.',
    icon: 'L',
    createFlow: (id) => {
      const nodes: Record<string, ChatbotNode> = {
        greeting: node('greeting', 'message', {
          text: "Hi! Let's get you connected with the right person. I just need a bit of info first.",
        }, { x: 300, y: 0 }, ['collect_name']),
        collect_name: node('collect_name', 'collect_input', {
          prompt: "What's your full name?",
          variable: 'name',
          validation: 'none',
        }, { x: 300, y: 120 }, ['collect_email']),
        collect_email: node('collect_email', 'collect_input', {
          prompt: "What's your work email?",
          variable: 'email',
          validation: 'email',
          errorMessage: "That doesn't look like a valid email address. Could you try again?",
        }, { x: 300, y: 240 }, ['collect_company']),
        collect_company: node('collect_company', 'collect_input', {
          prompt: "What company are you with?",
          variable: 'company',
          validation: 'none',
        }, { x: 300, y: 360 }, ['branch_email']),
        branch_email: node('branch_email', 'branch', {
          field: 'email',
          conditions: [
            { op: 'ends_with', value: '@gmail.com', nextNodeId: 'personal_email' },
            { op: 'ends_with', value: '@yahoo.com', nextNodeId: 'personal_email' },
            { op: 'ends_with', value: '@hotmail.com', nextNodeId: 'personal_email' },
          ],
          fallbackNodeId: 'ai_qualify',
        }, { x: 300, y: 480 }),
        personal_email: node('personal_email', 'message', {
          text: "Thanks! For the best experience, we recommend using your work email. But no worries — let me see how I can help.",
        }, { x: 0, y: 620 }, ['ai_qualify']),
        ai_qualify: node('ai_qualify', 'ai_response', {
          systemPrompt: "You are a helpful sales assistant. The prospect's name is {{name}}, email is {{email}}, and company is {{company}}. Ask them one qualifying question about their biggest challenge with customer support. Keep it brief and conversational.",
          maxTokens: 150,
          fallbackNodeId: 'handoff',
        }, { x: 300, y: 620 }, ['handoff']),
        handoff: node('handoff', 'handoff', {
          message: "Thank you for sharing! I'm now connecting you with a team member who can discuss solutions tailored to {{company}}. They'll have all the context from our conversation.",
        }, { x: 300, y: 780 }),
      };
      return {
        id,
        name: 'Lead Qualifier',
        nodes,
        rootNodeId: 'greeting',
        enabled: false,
        version: 1,
        status: 'draft',
        description: 'Collect lead info, AI-qualify, and hand off with full context.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
  },
];
