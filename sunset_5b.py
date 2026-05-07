path = r'C:\Users\mdsto\projects\phx2\src\components\SchedulerClient.tsx'
with open(path, 'rb') as f:
    raw = f.read()
text = raw.decode("utf-8")
lines = text.split("\n")
print(f"Before: {len(lines)} lines")

# Define ranges to delete by 1-based inclusive line numbers.
# Order matters: process in REVERSE so earlier ranges don't shift later ranges.
# Verified manually:
#   fetchWithRetry: 487..500  (function body)
#   executeTask:    586..2666 (useCallback definition + closing dep array)
#   runDueTasks:    2669..2693
#   cancelTask:     3078..3091
ranges = [
    (487, 500, "fetchWithRetry"),
    (586, 2666, "executeTask"),
    (2669, 2693, "runDueTasks"),
    (3078, 3091, "cancelTask"),
]

# Sanity-check that each range starts/ends with the right tokens.
def check(label, start, end, expect_start_substr, expect_end_substr):
    s = lines[start - 1]
    e = lines[end - 1]
    assert expect_start_substr in s, f"{label} start L{start}: expected {expect_start_substr!r}, got {s!r}"
    assert expect_end_substr in e,   f"{label} end   L{end}: expected {expect_end_substr!r}, got {e!r}"

check("fetchWithRetry", 487, 500, "async function fetchWithRetry", "}")
check("executeTask",    586, 2666, "const executeTask = useCallback", "[supabase, fetchTasks]")
check("runDueTasks",    2669, 2693, "const runDueTasks = useCallback", "}, [executeTask]);")
check("cancelTask",     3078, 3091, "async function cancelTask",     "}")

# Build new lines by skipping deleted ranges
new_lines = []
i = 0
deletions = sorted(ranges, key=lambda r: r[0])
range_idx = 0
for line_no in range(1, len(lines) + 1):
    if range_idx < len(deletions) and deletions[range_idx][0] <= line_no <= deletions[range_idx][1]:
        if line_no == deletions[range_idx][1]:
            range_idx += 1
        continue
    new_lines.append(lines[line_no - 1])

# Insert a tombstone comment in place
tombstone = (
    "  // Phase 5b: legacy executeTask, runDueTasks, fetchWithRetry, and cancelTask\n"
    "  // were removed here. Server-side runner (taskRunner.ts + /api/scheduler/*)\n"
    "  // is the only execution path now.\n"
)

# Find the spot where executeTask was (now after fetchTasks's closing) and insert tombstone.
# Easiest: insert tombstone right after the line that says "fetchTasks = useCallback" closing.
# Or just insert at the top of the file's effect-region — keep it simple.

# Quick approach: insert tombstone where the first deletion happened (right after the line
# preceding the original L487).
insert_after_marker = "  // ── Fetch helper with retry"
inserted = False
final_lines = []
for ln in new_lines:
    final_lines.append(ln)
    if not inserted and insert_after_marker in ln:
        # Replace this comment line with the tombstone
        final_lines[-1] = tombstone.rstrip("\n")
        inserted = True

text = "\n".join(final_lines)
with open(path, "wb") as f:
    f.write(text.encode("utf-8"))
print(f"After: {len(final_lines)} lines")
print(f"Removed: {len(lines) - len(final_lines)} lines")
