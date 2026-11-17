# harbormaster-main -> harbormaster-needs (install.sh step 3). Walks the layout bottom-up:
# Herdr's Agents block goes (and a container it leaves empty), the first Spaces block becomes
# the one-row picker, moved last in its column, and the Crew block gets the Needs-you box and
# the height that is left.
def is_crew: .content.mod? == "harbormaster" and .content.props.role? == "crew";
def is_spaces: .content.mod? == "spaces" or (.content.mod? == "harbormaster" and .content.props.role? == "spaces");
def picker: {"id": "spaces-picker", "type": "block", "size": {"px": 34}, "content": {"mod": "harbormaster", "props": {"role": "spaces"}}};
def empty_container: (.children? | type) == "array" and (.children | length) == 0;
.id = "hn-root"
| walk(if type == "object" and (.children? | type) == "array"
       then .children |= (
         map(select(.content.mod? != "agents"))
         | map(select(empty_container | not))
         | map(if is_crew then (.content.props.needs = "box" | .size = {"weight": 1}) else . end)
         | ([.[] | select(is_spaces)] | .[:1] | map(picker)) as $p
         | map(select(is_spaces | not)) + $p)
       else . end)
