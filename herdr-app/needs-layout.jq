# Makes a layout calm, once, for harbormaster-main (install.sh step 2; it is skipped when
# main already has Crew with needs: "box", so later edits of the user's are never redone).
# Herdr's Agents block goes, and a container only if the Agents block left it empty; Herdr's
# own Spaces block stays, moved just after Crew in its column, the first one with weight
# 0.5 and min 90 so Crew keeps the height; the Crew block gets the Needs-you box and weight 1. A Harbormaster Spaces picker
# of an earlier install becomes Herdr's Spaces block, in its place.
# With --argjson pickerOnly true it does only that last swap (install.sh runs it every time,
# so an older picker is replaced even in a layout that is already calm).
def is_crew: .content.mod? == "harbormaster" and .content.props.role? == "crew";
def is_picker: .content.mod? == "harbormaster" and .content.props.role? == "spaces";
# empty when it is Agents, or a container whose children were all Agents (or all such containers)
def strip:
  if .content.mod? == "agents" then empty
  elif (.children? | type) == "array" and (.children | length) > 0 then
    (.children |= [.[] | strip]) | if (.children | length) == 0 then empty else . end
  else . end;
# Each picker becomes Herdr's Spaces block, in the same place, under an id nobody else has.
def spaces_block($id): {"id": $id, "type": "block", "size": {"weight": 0.5}, "min": 90, "content": {"mod": "spaces"}};
def swap_picker:
  reduce (paths(type == "object" and is_picker)) as $p (.;
    ([.. | objects | .id? // empty]) as $taken
    | (first(("spaces", range(2; 1000) | if type == "number" then "spaces-\(.)" else . end) | select(. as $i | $taken | index($i) | not))) as $id
    | setpath($p; spaces_block($id)));
# The first Herdr Spaces block goes just after Crew when they share a column (Crew on top).
def is_spaces: .content.mod? == "spaces";
def move_spaces:
  (first(paths(type == "array" and any(.[]; is_crew) and any(.[]; is_spaces))) // null) as $p
  | if $p == null then . else
      getpath($p) as $c
      | ($c | map(is_spaces) | index(true)) as $si
      | ($c | map(is_crew) | index(true)) as $ci
      | ($c[$si]) as $sp
      | ($c | del(.[$si])) as $rest
      | ($rest | map(is_crew) | index(true)) as $ci2
      | setpath($p; $rest[:$ci2 + 1] + [$sp] + $rest[$ci2 + 1:])
    end;
# The first Herdr Spaces block shares the column with Crew (weight 1): half of Crew's height.
def size_spaces:
  (first(paths(type == "object" and .content.mod? == "spaces")) // null) as $p
  | if $p == null then . else setpath($p + ["size"]; {"weight": 0.5}) | setpath($p + ["min"]; 90) end;
if ($ARGS.named.pickerOnly // false) then swap_picker
else
  strip
  | swap_picker
  | size_spaces
  | move_spaces
  | walk(if type == "object" and is_crew then (.content.props.needs = "box" | .size = {"weight": 1}) else . end)
end
