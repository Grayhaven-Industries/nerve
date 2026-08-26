import { createFileRoute, Link } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: Landing
})

/** Minimal landing: the pitch, and the three ways in. */
function Landing() {
  return (
    <div className="landing">
      <section className="landing-copy">
        <h1>Check a harness before it reaches the floor.</h1>
        <p className="landing-sub">
          Nerve is an open-source compiler for wiring harnesses. Describe the harness, and the
          assistant writes the source; Nerve compiles it into the diagrams, parts lists, and
          checks a review needs. The harness is the deliverable. The code is how the AI builds
          it.
        </p>
        <div className="landing-links">
          <Link to="/showcase" className="landing-cta">
            See it on real harnesses
          </Link>
          <span className="sep">/</span>
          <Link to="/projects">Browse the examples</Link>
          <span className="sep">/</span>
          <Link to="/docs">Read the docs</Link>
        </div>
      </section>
    </div>
  )
}
