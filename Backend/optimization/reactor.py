"""Horizon-end obligations shared by the solver and manual Gantt report."""


def boundary_checks(vcr, cleanings, min_vcr, clean_days):
    def tail(flags):
        count = 0
        for flag in reversed(flags):
            if not flag:
                break
            count += 1
        return count

    checks = []
    days = tail(vcr)
    if days:
        checks.append({"level": "warn", "text": (
            "VCR is open at plan end (%d days in this plan, %d more required for the minimum). "
            "Schedule RX3-4 cleaning on the return to BR." % (days, max(0, min_vcr - days)))})
    for pair, flags in cleanings.items():
        owed = -tail(flags) % clean_days
        if owed:
            checks.append({"level": "warn", "text": "%s cleaning: %d more day(s) required after plan end."
                           % (pair, owed)})
    return checks
