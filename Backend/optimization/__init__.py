"""Production schedule optimizer for the TSL plant.

Phase 1: contract-first stub. `engine.solve()` returns the hand-built
28-day sample plan so the /optimize page can be developed against the
real endpoint. Deliberately independent of the forecast engine, the
database and third-party libraries. Phase 2 replaces the sample
generator inside engine.py with the CP-SAT model; nothing outside this
package changes.
"""
