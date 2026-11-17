# Makes a layout calm, once, for harbormaster-main (install.sh step 2; it is skipped when
# main already has Crew with needs: "box", so later edits of the user's are never redone).
# Herdr's Agents block goes, and a container only if the Agents block left it empty; the
# first Spaces block in the whole layout becomes the one-row picker, moved last in its
# column (any other Spaces block stays); the Crew block gets the Needs-you box and the
# height that is left.
def is_crew: .content.mod? == "harbormaster" and .content.props.role? == "crew";
def is_spaces: .content.mod? == "spaces" or (.content.mod? == "harbormaster" and .content.props.role? == "spaces");
def picker: {"id": "spaces-picker", "type": "block", "size": {"px": 34}, "content": {"mod": "harbormaster", "props": {"role": "spaces"}}};
# empty when it is Agents, or a container whose children were all Agents (or all such containers)
def strip:
  if .content.mod? == "agents" then empty
  elif (.children? | type) == "array" and (.children | length) > 0 then
    (.children |= [.[] | strip]) | if (.children | length) == 0 then empty else . end
  else . end;
def is_picker: .content.mod? == "harbormaster" and .content.props.role? == "spaces";
# not again when a picker is already there, so the transform is safe to rerun
def to_picker:
  if [.. | objects | select(is_picker)] | length > 0 then .
  else (first(paths(type == "object" and is_spaces)) // null) as $p
  | if $p == null then .
    else getpath($p[:-1]) as $sibs | setpath($p[:-1]; ($sibs | del(.[$p[-1]])) + [picker]) end
  end;
strip
| to_picker
| walk(if type == "object" and is_crew then (.content.props.needs = "box" | .size = {"weight": 1}) else . end)
