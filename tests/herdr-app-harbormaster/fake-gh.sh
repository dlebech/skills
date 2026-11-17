#!/usr/bin/env bash
# A fake `gh` for crew-sandbox.sh's two-prs run: `pr view` and the review-comments query for
# owner fake-two answer from here (PR 1799: 2 open threads, 1372: 9, 44, 60 and 61: none; 60-64 have one green check (10 min, a CI baseline of 3+ samples for fake-two/api); 70 has a check running for 45 min; all approved by
# mfalkenbrink). `api graphql` with a `viewer` query (mypr.js) answers 5 open PRs of dlebech: 11 red CI, 12 changes requested,
# 13 approved and mergeable, 14 two new comments since the push, 15 quiet; 16 is in a run; 17-20 have no reviewDecision (repo without required reviews): 17 anna's APPROVED stands, 18 her CHANGES_REQUESTED, 19 approved but CI pending, 20 approved with mergeable UNKNOWN.
# `search prs --review-requested` answers from <scratch>/review-requests.json (none without it). Anything else runs the real gh ($REAL_GH).
args="$*"
case "$args" in
  # <scratch>/no-mine makes the viewer query answer no PRs (a "nothing for you" shot).
  *"api graphql"*viewer*)
    if [ -e "$(dirname "$0")/../no-mine" ]; then echo '{"data":{"viewer":{"login":"dlebech","pullRequests":{"nodes":[]}}}}'; exit 0; fi
    jq -n 'def pr($n; $o): {number:$n,title:"Mine \($n)",url:"https://github.com/acme/app/pull/\($n)",isDraft:false,updatedAt:"2026-11-17T02:00:00Z",reviewDecision:null,mergeable:"MERGEABLE",
        repository:{nameWithOwner:"acme/app"},latestOpinionatedReviews:{nodes:[]},reviews:{nodes:[]},comments:{nodes:[]},reviewThreads:{nodes:[]},
        commits:{nodes:[{commit:{committedDate:"2026-11-17T01:00:00Z",statusCheckRollup:{state:"SUCCESS",contexts:{nodes:[]}}}}]}} * $o;
      {data:{viewer:{login:"dlebech",pullRequests:{nodes:[
        pr(11; {commits:{nodes:[{commit:{committedDate:"2026-11-17T01:00:00Z",statusCheckRollup:{state:"FAILURE",contexts:{nodes:[{__typename:"CheckRun",name:"build",conclusion:"FAILURE",detailsUrl:"https://ci/11"}]}}}}]}}),
        pr(12; {reviewDecision:"CHANGES_REQUESTED",reviews:{nodes:[{author:{login:"anna",__typename:"User"},state:"CHANGES_REQUESTED",submittedAt:"2026-11-17T01:30:00Z",body:"no"}]}}),
        pr(13; {reviewDecision:"APPROVED",reviews:{nodes:[{author:{login:"anna",__typename:"User"},state:"APPROVED",submittedAt:"2026-11-17T01:40:00Z",body:""}]}}),
        pr(14; {comments:{nodes:[{author:{login:"anna",__typename:"User"},createdAt:"2026-11-17T01:10:00Z"},{author:{login:"dlebech",__typename:"User"},createdAt:"2026-11-17T01:11:00Z"},{author:{login:"ci-bot",__typename:"Bot"},createdAt:"2026-11-17T01:12:00Z"},{author:{login:"bo",__typename:"User"},createdAt:"2026-11-17T00:00:00Z"}]},
          reviewThreads:{nodes:[{isResolved:false,comments:{nodes:[{author:{login:"anna",__typename:"User"},createdAt:"2026-11-17T01:20:00Z"}]}}]}}),
        pr(15; {}), pr(16; {reviewDecision:"APPROVED"}),
        pr(17; {latestOpinionatedReviews:{nodes:[{author:{login:"anna",__typename:"User"},state:"APPROVED",submittedAt:"2026-11-17T01:50:00Z"}]},reviews:{nodes:[{author:{login:"anna",__typename:"User"},state:"APPROVED",submittedAt:"2026-11-17T01:50:00Z",body:""}]}}),
        pr(18; {latestOpinionatedReviews:{nodes:[{author:{login:"anna",__typename:"User"},state:"CHANGES_REQUESTED",submittedAt:"2026-11-17T01:55:00Z"},{author:{login:"bo",__typename:"User"},state:"APPROVED",submittedAt:"2026-11-17T01:56:00Z"}]}}),
        pr(19; {reviewDecision:"APPROVED",commits:{nodes:[{commit:{committedDate:"2026-11-17T01:00:00Z",statusCheckRollup:{state:"PENDING",contexts:{nodes:[]}}}}]}}),
        pr(20; {reviewDecision:"APPROVED",mergeable:"UNKNOWN"})]}}}}'
    ;;
  *github.com/fake-two/*)
    n=$(grep -o 'pull/[0-9]*' <<<"$args" | head -1 | cut -d/ -f2)
    u=$(grep -o 'https://github.com/fake-two/[^ ]*' <<<"$args" | head -1)
    jq -n --argjson n "$n" --arg u "$u" --arg ago "$(date -u -d '45 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" '{number:$n,title:"Fake PR",state:"OPEN",isDraft:false,reviewDecision:"APPROVED",
      reviews:[{author:{login:"mfalkenbrink"},state:"APPROVED",submittedAt:"2026-11-17T01:00:00Z"}],reviewRequests:[],
      author:{login:"dlebech"},statusCheckRollup:(if $n == 70 then [{name:"build",status:"IN_PROGRESS",conclusion:"",startedAt:$ago,detailsUrl:"https://x/1"}] elif $n >= 60 then [{name:"build",status:"COMPLETED",conclusion:"SUCCESS",completedAt:"2026-11-17T01:00:00Z",startedAt:"2026-11-17T00:50:00Z",detailsUrl:"https://x/1"}] else [] end),url:$u,headRefName:"x",headRefOid:"sha\($n)",body:"",updatedAt:"2026-11-17T01:00:00Z"}'
    ;;
  *"api graphql"*"owner=fake-two"*)
    n=$(grep -o 'number=[0-9]*' <<<"$args" | head -1 | cut -d= -f2)
    t=2; [ "$n" = 1372 ] && t=9; [ "$n" = 44 ] || [ "$n" -ge 60 ] && t=0
    jq -n --argjson t "$t" '{data:{repository:{pullRequest:{author:{login:"dlebech"},
      reviewThreads:{nodes:[range($t)|{id:"th\(.)",isResolved:false,path:"app/X.php",line:(10+.),first:{nodes:[{author:{__typename:"User",login:"mfalkenbrink"},authorAssociation:"MEMBER",body:"Comment \(.)",url:"u"}]},last:{nodes:[{body:"Comment"}]}}]},
      reviews:{nodes:[]},comments:{nodes:[]}}}}}'
    ;;
  # Review requests (Next for you): from <scratch>/review-requests.json when there is one, else
  # none, so a sandbox never lists the user's real requests.
  "search prs"*"--review-requested"*)
    f="$(dirname "$0")/../review-requests.json"
    if [ -f "$f" ]; then cat "$f"; else echo '[]'; fi
    ;;
  *) exec "$REAL_GH" "$@" ;;
esac
