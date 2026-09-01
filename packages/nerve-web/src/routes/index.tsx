import { createFileRoute, Link } from "@tanstack/react-router"
import { docsUrl } from "../lib/site.js"

export const Route = createFileRoute("/")({
  component: Landing
})

/**
 * Long-form landing. The order is deliberate: the reader meets the problem
 * before the product, and meets what Nerve refuses to claim before the
 * feature list. For this audience the honesty section is the strongest
 * thing on the page, so nothing is allowed to run ahead of it.
 *
 * Every number here is real and checkable from the repository. There are no
 * testimonials because there are no customers to quote yet; the evidence
 * section uses public artifacts instead.
 */
function Landing() {
  return (
    <div className="landing">
      <section className="landing-hero">
        <h1>A drawing can&rsquo;t tell you it&rsquo;s wrong.</h1>
        <p className="landing-sub">
          So harness errors get found on the bench. At unit 40. By a technician with a
          multimeter.
        </p>
        <p className="landing-lede">
          Nerve compiles the harness instead. 53 checks with stable codes, byte-identical
          drawings and packets, and a report that names what it could not check.
        </p>
        <div className="landing-links">
          <Link to="/showcase" className="landing-cta">
            See it on a real harness
          </Link>
          <span className="sep">/</span>
          <Link to="/projects">Browse the examples</Link>
          <span className="sep">/</span>
          <a href={docsUrl("/docs")} target="_blank" rel="noreferrer">
            Read the docs
          </a>
        </div>
      </section>

      <section className="landing-proof">
        <div className="proof-item">
          <span className="proof-figure">53</span>
          <p>
            checks with stable <code>HK-*</code> codes. Gate a pull request on one. Cite one
            in a waiver.
          </p>
        </div>
        <div className="proof-item">
          <span className="proof-figure">16</span>
          <p>
            characters of content fingerprint over the compiled harness. Anyone can verify a
            packet against the release it claims to come from.
          </p>
        </div>
        <div className="proof-item">
          <span className="proof-figure">0</span>
          <p>
            bytes of difference between two builds of the same source. A revision reads as a
            diff, not a re-read.
          </p>
        </div>
      </section>

      <section className="landing-section">
        <h2>Three documents, and none of them can be wrong</h2>
        <p>
          You have a schematic PDF. A wire list in Excel. And the connector datasheet with the
          real pinout, somewhere in a downloads folder.
        </p>
        <p>
          The wire list says J1 pin 3 is CAN_H. The datasheet says pin 3 is CAN_L. Both
          documents are internally consistent. Both have been signed.
        </p>
        <p>Nothing in that process is capable of noticing.</p>
      </section>

      <section className="landing-section">
        <h2>The artifacts have no opinion</h2>
        <p>
          A PDF has nothing to say about the gauge you crimped into a 24AWG to 32AWG contact.
          A spreadsheet does not know that two rows describe the same physical conductor. A
          drawing renders whatever you drew, correctly, including the mistake.
        </p>
        <p>
          So review becomes attention. One person, reading carefully, on a Friday, at the end
          of a week.
        </p>
        <p className="landing-emphasis">
          Attention does not scale and it is not auditable. &ldquo;I checked it twice&rdquo;
          is not evidence.
        </p>
      </section>

      <section className="landing-section">
        <h2>What Nerve does instead</h2>

        <h3>It compiles the harness into something checkable</h3>
        <p>
          Whatever you start from, a WireViz file or a mapped spreadsheet or TypeScript,
          becomes one versioned, canonically sorted representation. Every check and every
          drawing reads that and nothing else, so an imported harness and a hand-authored one
          are judged identically.
        </p>

        <h3>It judges the part, not the drawing</h3>
        <pre className="landing-diagnostic">
          <code>
            {"error  connector:J1.pin:1  HK-MFG-004\n  Wire W1 uses 10AWG but connector J1 accepts 24AWG to 32AWG."}
          </code>
        </pre>
        <p>
          That range came from the connector&rsquo;s data, not from the design&rsquo;s claims
          about itself. A wire is judged against the contact that crimps it. A pin is judged
          against the pinout its part fixes.
        </p>

        <h3>It tells you how close passing was</h3>
        <p>
          A wire at 99% of its derated ampacity and a wire at 40% both pass. They are not the
          same design, so Nerve reports the margin on every check that passed, not just the
          verdict.
        </p>
      </section>

      <section className="landing-section landing-honest">
        <h2>What it will not claim</h2>
        <p>
          Nerve does not certify a harness. It does not claim compliance with an industry
          standard or with your customer&rsquo;s standard. A report records the checks that
          ran against the facts the design supplied, and it says so, inside the report.
        </p>
        <p>Two commands exist only to tell you where you actually stand:</p>
        <ul>
          <li>
            <code>nerve parts</code> reports which checks a part&rsquo;s data enables, and
            which stay inactive for want of a field.
          </li>
          <li>
            <code>nerve provenance</code> reports which limits a clean report currently rests
            on that nobody has verified.
          </li>
        </ul>
        <pre className="landing-diagnostic">
          <code>
            {"1 part(s) supply a limit a rule judges against without being verified.\nA clean report is only as good as these."}
          </code>
        </pre>
        <p className="landing-emphasis">
          That line is the reason to trust the other 53.
        </p>
      </section>

      <section className="landing-section">
        <h2>You&rsquo;re probably thinking</h2>

        <h3>&ldquo;We already use WireViz.&rdquo;</h3>
        <p>
          Good. Point Nerve at the YAML. It imports the project, including one that keeps
          reusable anchors in a separate prepend file, and anything it cannot represent
          without loss becomes an <code>HK-WV-001</code> diagnostic instead of quietly
          disappearing.
        </p>

        <h3>&ldquo;Our harnesses aren&rsquo;t complicated enough for this.&rdquo;</h3>
        <p>
          The errors that cost money usually are not complicated. A swapped pair. A gauge at
          the edge of a contact&rsquo;s range. A wire that arrives 30mm short of its bracket.
          None of those need a complex harness.
        </p>

        <h3>&ldquo;I am not rewriting our wire lists in TypeScript.&rdquo;</h3>
        <p>
          Do not. <code>nerve import</code> takes CSV and Excel through a column map you
          write, and every source row comes back accounted for as accepted or rejected, with
          row and column diagnostics. TypeScript is one supported input, not an adoption
          requirement.
        </p>

        <h3>&ldquo;This is just a linter.&rdquo;</h3>
        <p>
          It is also the packet. One compile writes the drawings, the BOM, the cut list, the
          labels, the bill of process, the continuity tests, the assembly instructions and the
          PDF build book. Same source, same bytes, every time.
        </p>

        <h3>&ldquo;How do I know the checks are any good?&rdquo;</h3>
        <p>
          You do not have to take that on faith. The{" "}
          <a href={docsUrl("/docs/reference/rule-coverage")} target="_blank" rel="noreferrer">
            rule coverage page
          </a>{" "}
          counts what the rule set is as a fraction of the problem, by failure mode, including
          the failure modes that no design representation can catch.
        </p>

        <h3>&ldquo;We would have to send our designs somewhere.&rdquo;</h3>
        <p>
          No. The CLI runs on your machine. The workspace on this site compiles in your
          browser, with no backend. Apache-2.0.
        </p>
      </section>

      <section className="landing-section">
        <h2>Evidence</h2>
        <ul>
          <li>
            Nerve imports NASA/JPL&rsquo;s open-source rover harnesses from their published
            WireViz files, unmodified, with prepend semantics intact. That runs on every
            release candidate.
          </li>
          <li>
            Three worked example harnesses live in the repository and compile in CI on every
            commit.
          </li>
          <li>
            The demo recording calls the real CLI, so it fails when the output stops matching.
          </li>
        </ul>
      </section>

      <section className="landing-section landing-close">
        <h2>Start with a harness you already have</h2>
        <pre className="landing-diagnostic">
          <code>npx --package=@grayhaven/nerve-cli nerve init .</code>
        </pre>
        <p>
          Then run <code>nerve validate</code>. If the harness is clean, it takes about a
          minute to find that out. If it is not, you get a code and a line.
        </p>
        <div className="landing-links">
          <Link to="/projects" className="landing-cta">
            Try it in the browser
          </Link>
          <span className="sep">/</span>
          <a href={docsUrl("/docs/quickstart")} target="_blank" rel="noreferrer">
            Quickstart
          </a>
          <span className="sep">/</span>
          <a href="https://github.com/tylergibbs1/nerve" target="_blank" rel="noreferrer">
            Source
          </a>
        </div>
      </section>
    </div>
  )
}
