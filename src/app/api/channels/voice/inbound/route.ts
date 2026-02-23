import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getIVRConfig,
  generateGatherTwiml,
  routeByDigit,
  generateVoicemailTwiml,
} from '@/lib/channels/voice-ivr';
import { createCall, getCallBySid, updateCall } from '@/lib/channels/voice-store';

export const dynamic = 'force-dynamic';

function twimlResponse(xml: string): NextResponse {
  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const callSid = formData.get('CallSid') as string ?? '';
    const from = formData.get('From') as string ?? '';
    const to = formData.get('To') as string ?? '';
    const digits = formData.get('Digits') as string ?? '';

    const menuId = request.nextUrl.searchParams.get('menuId');
    const config = getIVRConfig();
    const statusCallbackUrl = `${request.nextUrl.origin}/api/channels/voice/status`;

    // If no call record exists, create one
    if (callSid && !getCallBySid(callSid)) {
      createCall(callSid, 'inbound', from, to);
    }

    // If this is a digit response to a menu
    if (menuId && digits) {
      const menu = config.menus.find((m) => m.id === menuId);
      if (menu) {
        // Track IVR path
        const call = getCallBySid(callSid);
        if (call) {
          updateCall(call.id, {
            ivrPath: [...(call.ivrPath ?? []), digits],
          });
        }
        return twimlResponse(routeByDigit(menu, digits, config, statusCallbackUrl));
      }
    }

    // Initial call — play main menu
    if (!config.enabled) {
      return twimlResponse(
        generateVoicemailTwiml(config.voicemailGreeting, statusCallbackUrl),
      );
    }

    const mainMenu = config.menus.find((m) => m.id === config.mainMenuId);
    if (!mainMenu) {
      return twimlResponse(
        generateVoicemailTwiml(config.voicemailGreeting, statusCallbackUrl),
      );
    }

    return twimlResponse(generateGatherTwiml(mainMenu, statusCallbackUrl));
  } catch {
    // Fallback TwiML on error
    return twimlResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">We are experiencing technical difficulties. Please try again later.</Say><Hangup /></Response>',
    );
  }
}
