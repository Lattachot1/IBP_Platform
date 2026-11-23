# Reactor checks in the daily optimizer

The automatic schedule and the manual Gantt check use the same timing:

| Event | Check |
| --- | --- |
| First VCR day | RX3-4 age **before** production must be within the configured entry limit. |
| Last VCR day before a return to BR | RX1-2 age **after** production must be strictly below the exit limit. For a limit of 50, a day starting at 49 cannot be the final production day. |
| First BR day after VCR | RX3-4 starts cleaning and RX1-2 produces. |
| Cleaning | Age stays unchanged until the last day of a full cleaning window; only then does it reset to zero. |

The numerical limits come from `Backend/optimization/plant_config.yaml`.
These are daily planning rules, not instructions for operating equipment.

## What the horizon does not tell you

The last date displayed is not evidence of a switch. If the plan stops
three days into an eight-day VCR campaign, its checks report five more
VCR days required. If it stops two days into a seven-day cleaning window,
the checks report five cleaning days outstanding. The VCR age check
also reserves enough RX1-2 age for the minimum run: truncating the view
does not make an already impossible age limit pass.

These messages do not book production or cleaning in a later run.
There is no automatic transfer of elapsed VCR or partial cleaning in this
version. Do not treat a separately solved next horizon as a validated
continuation; extend the current horizon to inspect the actual return to BR.
