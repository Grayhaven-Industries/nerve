---
"@grayhaven/nerve-platform": minor
---

Add the object store.

Almost every record in the platform is immutable and already carries a
content-addressed identity, so storing one is a mapping from fingerprint to
record. What the store is for is the two things it refuses.

A fingerprint cannot come to mean two different things: a record is rehashed
on the way in and rejected if it does not match the identity it was filed
under. And the one genuinely mutable fact, which release is current for a
harness, moves only by compare-and-set, so a release cannot be lost to a
race between two reviewers.

The in-memory implementation is the reference a durable backend has to
behave like.
