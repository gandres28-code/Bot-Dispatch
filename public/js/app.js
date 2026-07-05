async function loadAdminDashboard(){try{const response=await fetch(`/admin-dashboard-data?t=${Date.now()}`);const data=await response.json();if(!data.ok)return;const s=data.stats||{};setText("dashTotal",s.totalUnits||0);setText("dashProgress",s.inProgress||0);setText("dashInspect",s.awaitingInspection||0);setText("dashReady",s.ready||0)}catch(error){console.log("Dashboard error:",error.message)}}function setText(id,value){const el=document.getElementById(id);if(el)el.innerText=value}function showPage(pageId,subtitle,navButton){document.querySelectorAll(".os-page").forEach(page=>page.classList.remove("active"));const page=document.getElementById(pageId);if(page)page.classList.add("active");document.querySelectorAll(".os-nav button").forEach(button=>button.classList.remove("active"));if(navButton)navButton.classList.add("active");setText("pageSubtitle",subtitle)}function openModule(title,url){setText("moduleTitle",title);setText("moduleUrl",url);document.getElementById("moduleFrame").src=url;document.querySelectorAll(".os-page").forEach(page=>page.classList.remove("active"));document.getElementById("modulePage").classList.add("active");setText("pageSubtitle",title)}function backToDashboard(){

    const frame=document.getElementById("moduleFrame");

    frame.src="about:blank";

    document.querySelectorAll(".os-page").forEach(page=>{
        page.classList.remove("active");
    });

    document
      .getElementById("dashboardPage")
      .classList.add("active");

    document
      .getElementById("dashboardFrame")
      .src="/dashboard.html";

    setText("pageSubtitle","Dashboard");

}function showComingSoon(name){alert(`${name} será el siguiente módulo.`)}loadAdminDashboard();setInterval(loadAdminDashboard,30000);try{const socket=io();socket.on("ops-update",loadAdminDashboard)}catch(error){}
