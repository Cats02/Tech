// Public availability contains dates and availability only, never booking details.
(() => {
    const root=document.querySelector('.booking-service-choice');
    if(!root)return;
    const service=root.querySelector('[name="service"]'),days=root.querySelector('[data-calendar-days]'),heading=root.querySelector('[data-calendar-month]'),status=root.querySelector('[data-calendar-status]');
    const target=root.querySelector('#calendar-target'),previous=root.querySelector('[data-calendar-prev]'),next=root.querySelector('[data-calendar-next]');
    if(!days)return;
    const localDay=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Adelaide',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
    const today=localDay(new Date()),minimum=today.slice(0,7),maximum=localDay(new Date(Date.now()+366*86400000)).slice(0,7);
    let month=minimum,controller;
    const inputs=[root.querySelector('[name="date"]'),root.querySelector('[name="date2"]')];
    const markSelection=()=>days.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.date===root.querySelector(`[name="${target.value}"]`).value)));
    async function load(){
        controller?.abort();controller=new AbortController();const current=controller;
        days.replaceChildren();days.removeAttribute('aria-busy');heading.textContent=new Intl.DateTimeFormat('en-AU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z'));
        previous.disabled=month<=minimum;next.disabled=month>=maximum;
        if(!service.value){status.textContent='Select a service to see available days.';return;}
        status.textContent='Checking availability…';days.setAttribute('aria-busy','true');
        try{
            const response=await fetch(`/book/availability?service=${encodeURIComponent(service.value)}&month=${month}`,{signal:current.signal});
            if(!response.ok)throw new Error('Availability unavailable');
            const data=await response.json();if(controller!==current)return;
            for(const label of ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']){const day=document.createElement('span');day.textContent=label;day.className='booking-calendar-weekday';days.append(day);}
            const offset=(new Date(month+'-01T12:00:00Z').getUTCDay()+6)%7;
            for(let i=0;i<offset;i++)days.append(document.createElement('span'));
            for(const day of data.days){
                const button=document.createElement('button');button.type='button';button.dataset.date=day.date;
                button.className=day.available?'booking-day available':'booking-day unavailable';
                const number=document.createElement('strong');number.textContent=String(Number(day.date.slice(-2)));
                const label=document.createElement('span');label.textContent=day.available?'Available':'Unavailable';
                button.append(number,label);button.disabled=!day.available;
                button.setAttribute('aria-label',`${new Intl.DateTimeFormat('en-AU',{dateStyle:'full',timeZone:'UTC'}).format(new Date(day.date+'T12:00:00Z'))}: ${label.textContent}`);
                button.addEventListener('click',()=>{root.querySelector(`[name="${target.value}"]`).value=day.date;markSelection();status.textContent=`${target.value==='date'?'Preferred date':'Second preference'} selected: ${day.date}. Press Show Available Times to continue.`;});
                days.append(button);
            }
            markSelection();status.textContent='Green: available times. Red: unavailable. Choose a day below. Times are not reserved until confirmed.';
        }catch(error){if(error.name!=='AbortError')status.textContent='Unable to load the calendar. You can still enter a date below and check available times.';}
        finally{if(controller===current)days.removeAttribute('aria-busy');}
    }
    function move(amount){const date=new Date(month+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+amount);month=date.toISOString().slice(0,7);load();}
    previous.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));service.addEventListener('change',load);
    target.addEventListener('change',markSelection);inputs.forEach(input=>input.addEventListener('change',markSelection));load();
})();
