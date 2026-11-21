"""Run deterministic counterexamples and event-order sweeps for the proposed controller."""
from dataclasses import dataclass, field
from itertools import permutations


@dataclass
class Research:
    revision: int = 1
    public_allowed: bool = True
    public_evidence: set = field(default_factory=set)
    processed: set = field(default_factory=set)
    status_answers: int = 0

    def event(self, event):
        if event == "status":
            self.status_answers += 1
        elif event == "files_only" and "turn_1" not in self.processed:
            self.processed.add("turn_1")
            self.revision += 1
            self.public_allowed = False
            self.public_evidence.clear()
        elif event == "public_result_v1" and self.public_allowed and self.revision == 1:
            self.public_evidence.add("external_source")


@dataclass
class Playback:
    purpose: str = "narrate"
    response: int = 1
    held: bool = False
    generated: bool = False
    drained: bool = False
    host_release: bool = False
    advanced: int = 0
    edits: int = 0
    turn_ids: set = field(default_factory=set)

    def event(self, event):
        if event == "onset":
            self.held = True
            self.response += 1
        elif event == "edit_final_1":
            if "turn_1" not in self.turn_ids:
                self.turn_ids.add("turn_1")
                self.edits += 1
        elif event == "disconnect":
            self.held = True
            self.response += 1
        elif self.response == 1 and not self.held:
            if event == "generated_1":
                self.generated = True
            elif event == "drained_1":
                self.drained = True
            elif event == "host_release_1":
                self.host_release = True
            if self.generated and self.drained and self.host_release and self.purpose == "narrate":
                self.advanced += 1
                self.response += 1


@dataclass
class Voice:
    epoch: int = 1
    phase: str = "research"
    speaking: str = ""
    host_speaking: bool = False
    pending: list = field(default_factory=list)

    def offer(self, purpose, epoch):
        if epoch == self.epoch:
            self.pending.append((epoch, purpose))
            self.pump()

    def pump(self):
        if self.pending and not self.speaking and not self.host_speaking:
            _, self.speaking = self.pending.pop(0)

    def enter_live(self):
        self.epoch += 1
        self.phase = "live"
        self.pending.clear()
        self.speaking = ""


def check_handoff():
    # An utterance authorized in the private phase may arrive on either side of Present.
    orders = list(permutations(["private_result", "present", "end_host_turn"]))
    for order in orders:
        voice = Voice(host_speaking=True)
        for event in order:
            if event == "private_result":
                voice.offer("private_research_answer", 1)
            elif event == "present":
                voice.enter_live()
            else:
                voice.host_speaking = False
                voice.pump()
            if voice.phase == "live":
                assert voice.speaking != "private_research_answer" and not voice.pending, order
            if voice.host_speaking:
                assert not voice.speaking, order
    print(f"Private/public handoff: {len(orders)} orders; late research audio cannot enter public playback.")


def check():
    schedules = set(permutations(["status", "public_result_v1", "files_only", "files_only"]))
    for schedule in schedules:
        state = Research()
        for event in schedule:
            state.event(event)
        assert state.revision == 2 and state.status_answers == 1 and not state.public_evidence, schedule
    print(f"Research: {len(schedules)} orders; status answered, correction applied once, final bundle files-only.")

    # At the host, onset precedes a release opportunity. The release is suppressed locally.
    # AWS may still receive provider completion before it receives the host's hold.
    interrupted = set(permutations(["onset", "drained_1", "generated_1", "edit_final_1", "edit_final_1"]))
    interrupted = [order for order in interrupted if order.index("onset") < order.index("edit_final_1")]
    naive_advances = 0
    for order in interrupted:
        state = Playback()
        for event in order:
            state.event(event)
        assert state.advanced == 0 and state.edits == 1, order
        if max(order.index("drained_1"), order.index("generated_1")) < order.index("onset"):
            naive_advances += 1
    print(f"Barge-in: {len(interrupted)} orders; provider-only completion would advance early in "
          f"{naive_advances}; host release guard advanced early in 0.")

    normal = set(permutations(["generated_1", "drained_1", "host_release_1", "drained_1"]))
    for purpose in ("narrate", "answer", "demo", "brief_question"):
        for order in normal:
            state = Playback(purpose=purpose)
            for event in order:
                state.event(event)
            assert state.advanced == int(purpose == "narrate"), (purpose, order)
    print(f"Normal/duplicate delivery: {4 * len(normal)} schedules across four purposes.")

    state = Playback()
    for event in ("disconnect", "generated_1", "drained_1", "host_release_1"):
        state.event(event)
    assert state.held and not state.advanced
    print("Reconnect: old generation cannot advance.")

if __name__ == "__main__":
    check()
    check_handoff()
