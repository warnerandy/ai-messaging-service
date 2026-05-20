export const THINKING_BLURBS = {
	witty: [
		"Consulting the tiny genius in the ceiling.",
		"Translating sparks into sentences.",
		"Pretending this was obvious all along.",
		"Brewing a fresh pot of context.",
		"Assembling words with suspicious confidence.",
		"Checking whether that idea wears a tie.",
		"Tuning the answer until it hums.",
		"Negotiating with the punctuation department.",
		"Dusting off the good verbs.",
		"Searching for the least embarrassing brilliance.",
		"Running a quick vibe check on reality.",
		"Untangling the smart part from the loud part.",
		"Feeding the hamster that powers the logic wheel.",
		"Comparing clever options with a dramatic squint.",
		"Double-knotting the reasoning.",
		"Sharpening a response on the nearest fact.",
		"Trying not to overthink the thinking.",
		"Organizing electrons into a respectable opinion.",
		"Letting the idea simmer for flavor.",
		"Checking the answer for loose metaphors.",
		"Borrowing a flashlight from common sense.",
		"Polishing a likely correct sentence.",
		"Asking the inner committee for one final vote.",
		"Looking for the elegant route through the mess.",
		"Rehearsing the useful part.",
		"Measuring twice, phrasing once.",
		"Converting intuition into indoor plumbing.",
		"Folding nuance into a carry-on size.",
		"Attempting to make this both smart and readable.",
		"Checking whether the answer can survive daylight.",
		"Aligning facts, style, and a mild sense of drama.",
		"Sneaking up on the point.",
		"Putting the right amount of clever on it.",
		"Rescuing a thought from unnecessary complexity.",
		"Letting the better answer elbow past the first one.",
		"Calibrating for usefulness over theater.",
		"Turning a pile of maybes into a decent yes.",
		"Testing the sentence for structural integrity.",
		"Sweeping for bugs in the logic attic.",
		"Teaching the answer to arrive in order.",
		"Replacing hand-wavy with actually helpful.",
		"Doing the mental equivalent of rolling up sleeves.",
		"Trying a bold idea, then adding guardrails.",
		"Looking for a clean landing.",
		"Crossing the t's and side-eyeing the i's.",
		"Compressing ten thoughts into one useful one.",
		"Giving the response a quick tune-up.",
		"Making the answer less weird than the draft.",
		"Checking for elegance, then settling for solid.",
		"Preparing a response with at least one good angle.",
	],
	dry: [
		"Applying unnecessary restraint to several good ideas.",
		"Reducing chaos to bullet points.",
		"Verifying that confidence and accuracy remain acquainted.",
		"Selecting the least regrettable phrasing.",
		"Running the answer through a basic dignity filter.",
		"Converting noise into something billable.",
		"Checking whether the obvious answer is also correct.",
		"Removing three clever parts and keeping the useful one.",
		"Organizing facts into a format acceptable to adults.",
		"Performing light maintenance on the conclusion.",
		"Rearranging certainty into a safer shape.",
		"Testing whether brevity can survive contact with nuance.",
	],
	dramatic: [
		"Summoning an answer from the storm above the stack.",
		"Holding counsel with the thunder of possibility.",
		"Forging a sentence in the furnace of context.",
		"Waiting for the right idea to step from the fog.",
		"Gathering the loose sparks before they become insight.",
		"Charting a course through the ruins of bad drafts.",
		"Listening for the one sentence that enters like a hero.",
		"Bracing the reply against the winds of ambiguity.",
		"Giving the truth a more cinematic entrance.",
		"Pulling a clean answer from the mouth of the machine.",
		"Sharpening the point until it glints.",
		"Escorting the better idea onto the stage.",
	],
}

export function pickThinkingBlurb(blurbs = THINKING_BLURBS.witty, random = Math.random) {
	if (!Array.isArray(blurbs) || blurbs.length === 0) {
		return ""
	}

	const index = Math.floor(random() * blurbs.length)
	return blurbs[index]
}

export function formatThinkingDuration(elapsedMs) {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60

	return `${minutes}:${String(seconds).padStart(2, "0")}`
}
