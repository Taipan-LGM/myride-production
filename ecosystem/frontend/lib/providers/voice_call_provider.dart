import 'package:flutter_riverpod/flutter_riverpod.dart';

enum CallStatus { idle, connecting, active, ended }

class VoiceTranscriptLine {
  const VoiceTranscriptLine({required this.text, required this.isRider, required this.timestamp});
  final String text;
  final bool isRider;
  final DateTime timestamp;
}

class VoiceCallState {
  const VoiceCallState({
    this.status = CallStatus.idle,
    this.callId,
    this.transcripts = const [],
    this.durationSeconds = 0,
    this.isAiProcessing = false,
    this.dispatchedTripId,
  });

  final CallStatus status;
  final String? callId;
  final List<VoiceTranscriptLine> transcripts;
  final int durationSeconds;
  final bool isAiProcessing;
  final String? dispatchedTripId;

  VoiceCallState copyWith({
    CallStatus? status,
    String? callId,
    List<VoiceTranscriptLine>? transcripts,
    int? durationSeconds,
    bool? isAiProcessing,
    String? dispatchedTripId,
  }) =>
      VoiceCallState(
        status: status ?? this.status,
        callId: callId ?? this.callId,
        transcripts: transcripts ?? this.transcripts,
        durationSeconds: durationSeconds ?? this.durationSeconds,
        isAiProcessing: isAiProcessing ?? this.isAiProcessing,
        dispatchedTripId: dispatchedTripId ?? this.dispatchedTripId,
      );
}

final voiceCallProvider = StateNotifierProvider<VoiceCallNotifier, VoiceCallState>((ref) => VoiceCallNotifier());

class VoiceCallNotifier extends StateNotifier<VoiceCallState> {
  VoiceCallNotifier() : super(const VoiceCallState());

  void startCall(String callId) => state = VoiceCallState(status: CallStatus.active, callId: callId);

  void addTranscript(String text, {required bool isRider}) => state = state.copyWith(
        transcripts: [
          ...state.transcripts,
          VoiceTranscriptLine(text: text, isRider: isRider, timestamp: DateTime.now()),
        ],
      );

  void setAiProcessing(bool v) => state = state.copyWith(isAiProcessing: v);

  void tick() => state = state.copyWith(durationSeconds: state.durationSeconds + 1);

  void endCall({String? tripId}) => state = state.copyWith(status: CallStatus.ended, dispatchedTripId: tripId);

  void reset() => state = const VoiceCallState();
}
