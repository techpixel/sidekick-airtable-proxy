Create a proxy between Sidekick and a YSWS Airtable base. You can check the protocol at https://github.com/ascpixi/sidekick/blob/main/docs/PROTOCOL.md.

These are the columns in our Airtable:

Code URL,Playable URL,How did you hear about this?,What are we doing well?,How can we improve?,First Name,Last Name,Email,Screenshot,Description,GitHub Username,Address (Line 1),Address (Line 2),City,State / Province,Country,ZIP / Postal Code,Birthday,Optional - Override Hours Spent,Optional - Override Hours Spent Justification,Automation - Submit to Unified YSWS,Automation - Error,Automation - First Submitted At,Automation - YSWS Record ID,Loops - Special - setFullName,Loops - birthday,Loops - Special - setFullAddress,Hackatime Project Name,Rejected

**Each record in our base is a ship.** We don't have any re-ships. This means that the timeline ALWAYS only holds one event: the ship event. Each record that does not hold `true` in `Automation - Submit to Unified YSWS` is a pending ship.

**An approval MODIFIES the record, instead of creating a new one.** We also don't show any public-facing user feedback, so feel free to discard whatever the user wrote in the public feedback field (and always show a constant string like "(none)" when sending data back to Sidekick for the public feedback fields). Only the internal justification matters (which gets written to `Optional - Override Hours Spent Justification`). An approval sets `Automation - Submit to Unified YSWS` to `true`, also running an automation we have set up in the base.

The number of assigned hours goes into **Optional - Override Hours Spent**.

Resolve actors best-effort. We have Hackatime fuzzy searching (check https://hackatime.hackclub.com/api-docs for Hackatime docs) and Slack to try and resolve Hackatime IDs/Slack IDs by e-mail, GitHub Username,

When constructing the description for projects, include `Description` **AND** `Original Hours` (add a epilogue like "Author originally logged <HOURS>").

A rejection should mark `Rejected` as `true`.

Each submission record is its own project, even when records share the same code URL or repo URL — do not merge them, since they carry distinct Hackatime projects, hours, and authors.

You can inspect the Airtable base at https://airtable.com/app9SfJm8LOTJKm0A/tbllB2MlHnfep54wK/viwuFxeW81Tf2PzBk?blocks=hide.