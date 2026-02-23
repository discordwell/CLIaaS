import { NextResponse } from 'next/server';
import { getCallBySid, updateCall } from '@/lib/channels/voice-store';
import { ticketCreated } from '@/lib/events';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const callSid = formData.get('CallSid') as string ?? '';
    const callStatus = formData.get('CallStatus') as string ?? '';
    const callDuration = formData.get('CallDuration') as string;
    const recordingUrl = formData.get('RecordingUrl') as string;
    const transcriptionText = formData.get('TranscriptionText') as string;

    const call = getCallBySid(callSid);
    if (!call) {
      return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};

    // Map Twilio status to our status
    const statusMap: Record<string, string> = {
      'ringing': 'ringing',
      'in-progress': 'in-progress',
      'completed': 'completed',
      'busy': 'busy',
      'no-answer': 'no-answer',
      'failed': 'failed',
    };
    if (statusMap[callStatus]) {
      updates.status = statusMap[callStatus];
    }

    if (callDuration) {
      updates.duration = parseInt(callDuration, 10);
    }

    if (recordingUrl) {
      updates.recordingUrl = recordingUrl;
      updates.status = 'voicemail';
    }

    if (transcriptionText) {
      updates.transcription = transcriptionText;
    }

    updateCall(call.id, updates as Parameters<typeof updateCall>[1]);

    // Auto-create ticket for voicemails
    if (updates.status === 'voicemail' || recordingUrl) {
      ticketCreated({
        channelType: 'phone',
        callSid,
        from: call.from,
        recordingUrl: recordingUrl ?? call.recordingUrl,
        transcription: transcriptionText ?? call.transcription,
        autoCreated: true,
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Status callback failed' }, { status: 500 });
  }
}
