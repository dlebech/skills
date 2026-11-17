#!/usr/bin/env bash
# A fake `gh` for crew-sandbox.sh's two-prs run: `pr view` and the review-comments query for
# owner fake-two answer from here (PR 1799: 2 open threads, 1372: 9, 44, 60 and 61: none; 60 and 61 have one green check; all approved by
# mfalkenbrink). Anything else runs the real gh ($REAL_GH).
args="$*"
case "$args" in
  *github.com/fake-two/*)
    n=$(grep -o 'pull/[0-9]*' <<<"$args" | head -1 | cut -d/ -f2)
    u=$(grep -o 'https://github.com/fake-two/[^ ]*' <<<"$args" | head -1)
    jq -n --argjson n "$n" --arg u "$u" '{number:$n,title:"Fake PR",state:"OPEN",isDraft:false,reviewDecision:"APPROVED",
      reviews:[{author:{login:"mfalkenbrink"},state:"APPROVED",submittedAt:"2026-11-17T01:00:00Z"}],reviewRequests:[],
      author:{login:"dlebech"},statusCheckRollup:(if $n >= 60 then [{name:"build",status:"COMPLETED",conclusion:"SUCCESS",completedAt:"2026-11-17T01:00:00Z",startedAt:"2026-11-17T00:50:00Z",detailsUrl:"https://x/1"}] else [] end),url:$u,headRefName:"x",headRefOid:"abc",body:"",updatedAt:"2026-11-17T01:00:00Z"}'
    ;;
  *"api graphql"*"owner=fake-two"*)
    n=$(grep -o 'number=[0-9]*' <<<"$args" | head -1 | cut -d= -f2)
    t=2; [ "$n" = 1372 ] && t=9; [ "$n" = 44 ] || [ "$n" -ge 60 ] && t=0
    jq -n --argjson t "$t" '{data:{repository:{pullRequest:{author:{login:"dlebech"},
      reviewThreads:{nodes:[range($t)|{id:"th\(.)",isResolved:false,path:"app/X.php",line:(10+.),first:{nodes:[{author:{__typename:"User",login:"mfalkenbrink"},authorAssociation:"MEMBER",body:"Comment \(.)",url:"u"}]},last:{nodes:[{body:"Comment"}]}}]},
      reviews:{nodes:[]},comments:{nodes:[]}}}}}'
    ;;
  *) exec "$REAL_GH" "$@" ;;
esac
