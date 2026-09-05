import { sanitizeDocumentTemplateHtml, sanitizeGeneratedDocumentHtml } from '@/lib/htmlSanitizer';
import { calculateCrmItem, calculateCrmTotals } from '@/lib/crmItemPayloads';

let AlignmentType;
let BorderStyle;
let Document;
let HeadingLevel;
let ImageRun;
let Packer;
let Paragraph;
let Table;
let TableCell;
let TableRow;
let TextRun;
let WidthType;
let docxModulePromise;

const ensureDocxModule = async () => {
  if (!docxModulePromise) {
    docxModulePromise = import('docx').then((module) => {
      ({ AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = module);
    }).catch((error) => {
      docxModulePromise = null;
      throw error;
    });
  }
  await docxModulePromise;
};

const documentTypeLabels = {
  offer: 'Nabídka',
  order: 'Objednávka',
  contract: 'Smlouva',
  handover_full: 'Celkový předávací protokol',
  handover_partial: 'Částečný předávací protokol',
  service_protocol: 'Servisní protokol',
};

const ekvProjectLogoDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA/cAAAC0CAYAAADRotyQAAAACXBIWXMAACZyAAAmcgEhK5fuAAAgAElEQVR4nO3dTXLiSPcu8Oe90XN8V2ApQoPLyPQKrFpBmRVYPbhMi15BqVbQ9JRJyRu44BW0vIK2R0yIkLyCv1nBewc6lFWUEQJl6qSk5xdB9Ad2cqwv8uTnf/773/+CiIiIiIi6JfB8b5tnuXYcROSG/6UdABERERER1Rd4fhh4/jOASDsWInLHb9oBEBERERHRaYHnewAWAD7L/1qrBUNEzmFyT0RERETksMDzrwDM5TVSDoeIHPXbeLZKtYOg4zbLaajxuePZKgbwVeOzP/Bps5ym2kGMZ6s7ACvtOEqmm+X0ohb78Wz1BncqBw+b5TTSDsIl49nqCsD/aMdR0olzFHj+AsBEO44TngG8yT/zbZ49K8fzocDzI7g/3DeX1/54Pm/z7E0zINdJgjgBsP/nnicv4P0axcF/8/gqkfsxBnDd4mfGcKce2KZP2zxLtYM4V+D5ExT38ATv97iH09fMC4r7O5fX/lmaWwn0Ah35PnJF8huAW+0oiDriTjuAsksTe7GAO1/a9+PZar5ZTllpfOfUtYbieumCCdz/TvspvsDzAeAJQApg7VCy76FjxxIAAs9/RXEsUwCpSxVUDYHnhwD2rwnqNeoePe+B5+9QVP5TFMc3bRgiVZDzF8P9e5FaJtMz7vB+f1/aYXMj/zz8btrh/Vm6Vn6WeuA9UMcOwJrD8onqC7UDKHls+PsJ3EnugaJFtisJZBvm2gGUPG2WU1cSzr66lddXSU7XABZDT0wvdA3gXl4IPP8FxfMuGUKvs/TM38nr84kfv8QIP1+v+wRgjSIB6P0xboOcxwXkOiYCflwXkbxuKn+4uRGKZ8hnAH+VnqXaiT4dF2/z7I2r5RPVMJ6tJmhxOFwNjRbQ2SynOYAHM6EYEWkH4IrxbOXB/pf2ORLtAAbmGsAXAFng+an03NHlbgD8BeB/As9PpLerd2Tl9ATFdJ7vsJPYf2SfAHwHkMsxdn1qjNNkOHwOJvYkDu7vv6BTR9g/S7PA89f8bnLO6zbPFgC3wiOqK9IO4ICJ1XFd6im/kQYUcqvX/nWznCbaQQzYLYB/JMnn/dHcPYqKaSI9YJ0nlf4UwD/QTwZHEsO/bJg6X+D5d4Hn5yhG1bmyJg4pcuz+LvuM9++mUDsYAlDKU5jcE9UTagdQ8mJifroMtX4yEI8pLiW1miLtAEpcagAaslsUCVOsHUhP3KPoZe7sM+eg0u/iXFQ2TNUUeP5EzuUKbo0QJCWB53vSU+/q/b23v8/XfR0V1RFP5fVPmNwTndDzYdImy2rKtUXkWic7MrjSY7ODW9cHFXOcn5ksGTFCMY807VIvfuD5Vx2p9O/tG6YWXTrObZBzuQDwL7pxLqkF0uj4DLd66k/5DOC5yw2mHReV/4PJPdFpriWdqamCZMj1q6nyGhqNZ6tIOwhlkXYAJWvuYOCkGwBp4PmuPZe66hZFpdT5BhM55zm6Venf+4LiOIfagbhAtvbKURwXon1jzxrFvHZXGvnP0ckG0x74drjAIZN7otNC7QBKXi2sXJ4YLq+JwSYsMkKkrUWw6oi1A6CjRgBWkiBQc9coGkycTfClh3eFblb6965RDOGNtQNxQIRun0sySJ49OdyqA1yqMw2mPbDDB9MnmdwTVRjPVldw62FrYiG9QwsUDwgXfJYkd4hcath4kh0VyG3fmeAbM4KDCb705j2jXz28X2WOLnv3aPDkGZ6iX409+wZTl+o1fTT/aPtRJvdE1Vx7MBlP7mXotY1Gg0tF2gEocWmuWqwdANX2nUOdjdkn+J5yHAB+7Gmdwq01X0z5jOJYM8GnwZLE/jv6ldjvcYSZXS/bPEs+eoPJPVG1UDuAkt1mOU0tlR1bKvcSkXYAbRvPViHcWSX51eJ1RnZwpWJzRiiOp2rSWRqm28fEfm+/fgQTfBqcUmLfd9/Zg2/F0Q4hJvdE1Vx6IFnrXZch2K5si3ctye6QRNoBlMTaAdDZRnBr9E3X3UDxPij12PexN+8QE3wanAEl9nuJa1OeOu6xvPXdISb3REdIgulS5Sq1XL5Le5pH2gG0RdZ1cKURaQcmiV11w4XKjPqiMd1hYIn9HhN8Ggx5rgwpsQfepzzxHm9uhxPTOJncEx3nSsK1ZzXp2iyna7izLd69JL1D4NLe9gm3v+u0rxyeb1Ss8Jlr9Hso/jE3cKuBmcg4eT4PtQGdI8zMWBxufXeIyT3RcS4l948tJV0uVa5cOv42RdoBlLh0/ukysXYAPXLb5mJQst3dbVuf56D7wPNdWliUyLQ13GnM13DLe7yRV9Sop/3WQiBEnTOerSZwZ4EzwP6Q/L0ERXLgwpfPHEU8vSXb/rlSmX/g9nc/eUGzHQyuAExKr7aeJ/eB58enWvYVfGr4+568JigWOm3rGdXKc0iG6vZpu7tL/RV4frrNs2ftQMisbZ79RzsGTTJtSnNUzguAcifRBDp1vTjw/PWZ31EJ2qsHA0UCbepcNa1LlOUfbX13iMk90cdC7QAOtDKUabOcvo1nqwRuVDJvxrOV1/OE06UW7EQ7AMe8VS1YU9OP+1YWE4rkZbtCFcOtESEwcCx/0uLxvAk8PzQdf5nMQ217uOoLispyDuBYIh3ivUGlzaRkHXj+pE4llqgL5Hn1tcWPfEHxTEkBPFfdSxLbvtG0jWmCIxT1jbDuL0hDQG4lmg8Enm/y2WOiLnEWJvdEH4u0Ayh5aTnBXcCN5B4okl+XEmDTXJl68MLt7+ySnsi59N7sr2tblaj7wPPnfU6OPjieNivOEez2GsVopwftCUWlel3z2kj3/yJzhe9QHAvbif41inMaW/4corYkLXzGDkX9LTmnV1yepc+QGGXbujnsjiq8td1oOmScc090QBZyc2lBo7TND5OGhMc2P7NCpB2ALePZ6g7uTP3gXPuWbPPsbZtnMYpeixeLH+VKw5FVpeP5O+wtCGrtWLY0HP8JwKdtnoXbPEsuafTZ5lm+zbPFNs8mKKZY2N46lYtDUi/Iuh2265TfAHjbPGs8JWubZ+ttnoUo7nObiyzHFsseNCb3RL9yrVKcKHymK8neSJLgPoq0AxC7zXKaaAcxNNJbEsJegt/X++ZDcjwnsHM8Rxa3xYstlQsUPXlTSepTU4Vu8yyVyv8f8hm2JBbLJrJOptzYrE+9APhdknqjI7XkmTEB8LfJcktuNbYbHQIm90S/cqlSvNssp60vLCRDtF3ZFi/SDsA0GR3yWTsO4UpDzuBIZSyEnXvNleurNXI8I9hJOEPTBUrF1tbQ1xcUPXnW5vJv8yyBvQYVgJV/6j6b068eAIQ2F5+UkVFzFA15NvR52qUaJvdEv3KpUqy5J2is+Nlln2VV+T6JtAMoYXKvqJSQGjfExEgqurGFokMLZcYWygSAh22etbIgnQwBDmEvwY8tlUtklfTa20peH7Z5FrW1roo05NlI8D/LcSKDmNwTlTg4BFwtuZeh2jaHXJ7DtfPSlCut1Q+b5bS3i651hQx/fLBQdGihTOdt82wB86MhJiYLs9hr/7DNs8hCuUeVRqDYSPBvZTVvoq6xtfJ86/c48CPB/2awyBcUa4GwDmIYk3uinzmVRG6WU82ee8CdXl1XkuHGxrNVm3uen+LK+aXu9DZ3heln58hwD5ONZ5rJ/ZTPYjnB783znwYltlDmk0ZivyeLlzZdTHMH4A8ZXZQ2Dop+weSe6GehdgAlLqxYn2gHIK7Hs1WoHYQhrlRUnzTWc6CPyfBm04mRZ7i8LkkslGmkB1lWgTc9/WsH4E6zF8ziFJN7Dt2lLpHRJqYb8XdwowMqavC7+1X9EzOh0EeY3BMJx3pUAd359gB+bItnY7jwJSLtAAxx4csZcKfhht4lhstz6XnWKpuLTBlg4xnQeAssE+S4mxy6u+fKc5OoDhuN+HMXhrDLc+bceuETAN/Gqv70Kyb3RO8i7QAOpNoBiEQ7AHEnq8x31ni2imBv5dxzvHL7OycZT0gH3uNpei/20FA5kaFy9p5knQEnyNBd02seuDLiiagO041RT471dsc1f+4Vxbz60IXGx6Fgck/0LtQOoORFes3VybZ4tlZCPscI3e+9ibQDEM4kAvTO0vxDLkbmEBmSf2O42NhweSZEhsu7GXhDFXWELJZpuhE/NlxeI5KoVzWe7gD8uc0zj/Pq28fkngiAbLVmusLVRKIdwAFXksFIO4BLyTVma0/rc+zg3vVFZIOLwz9t9OilhstsTGIy3Xvf9cZdGoZB3OM4PnX0bxTz6l2pNw4Ok3uigmuVhlQ7gDIZwm26onaJ2w7veR9pByDW3P7OaS6MkukLF69z0981LlegY8PlufY9TfSR0HB5rt7jh8n9E4Dft3nmxNoAQ8bknqgQagdQ8uroKuaJdgCiq3MvI+0ARKwdAFVipcgcTzuAD5gcvfO6zTP1hVcrrFGMFDIlNFgWkXEydcTkKNCdq/e4DM3foej4mcq8ehfrroPD5J4GTxZpM70tURNOPsjhTutx53pvxrPVHdxYufzJlbUc6CjOke8pmYtrkqvfFQB+bI1nMsaRbDFG5CrT12diuDzTIplX7/SzaGiY3BO5lyym2gF8RIZyu7At3rUky13iSryxdgB0kgu7KfSF6Yp2014p0/F0oUJtOkYm9+Sy0HB5Tt/jTOrdxOSeyK2hfrvNcuryw9KV3vtIO4C6ZGTIvXYcKKZ7pNpB0HGykrppgxzmLz28phtKmh5Lk4npztFFtg6lhstjck8uM3p9duQeJ8f8tllO/6MdBJEyV3pVAcdbaTfL6fN4tnqC/qrvn8ez1VVHFoaLtAMQsXYAdJLxxGXAcyBtPNfzhr9v8vx24rxu8+wt8PwXmJuHzOSeXGby+qzaao7oKPbc06CNZ6sQbg2DTbUDqIG99+eJtANAseiN0w1HBMB8QmpyMbOuiUwXKAtINWFyoa3UYFm2pQbLYnJPLjO5tk5qsCwakN+0AyBS5lKvPdCBBGyznK7Hs9Ur9BeIi+BOQ8OHxrPVBGYr9JdKOjLKYehMP4860btrWuD5c5h/PjXqRbMw5aJL59ZkrC41xtMZAs+PtWM4ZptncdMyBn6Pk0OY3NPQuZTcP3UoAVsA+Es5hpvxbDVxdNvAPVe27XO6EYSAwPMjmE9cXL43rJC59rGFopseS89EECVdOre5ycICzw85F7mTvmoHcMTfhsrxDJWzlxsujwaCw/JpsKRXVbv3ucz5XvuSBG4M+XUleT7GhcajB25/1wmxhTK7lAA2Jj1na9jp3U0b/v6ViSD2DEwRaA0TcXLYDuaevabv8UE9v8kcJvc0ZKF2AAc6k9zLCAMX4nUhef7QeLaK4MYQ0kQ7AKomw1VtNDSmFsp0kuwh/ww7x3FnYMsnk3PFXw2W1UWedgDUG/E2z0yNmOR6EOQEJvc0ZJF2ACUvHexdjbUDADCSJNpFLjQ8vHD7O7fJcHwbw1VfutS7e6nA873A8xMA/8BeY5oLDZlluXYAF3gxWJZnsCwartdtnrk6ZY0r5dPFmNzTIMne4y4sdLaXagdwLmmMeNSOA2410gAAxrOVB+CzdhzgXHunSWL/3VLxqaVy1UlCHwWevwaQAbi3/JGJ5fKHoCvrydBwRNoBENnABfVoqFzoVS1LtAO40AL6SezteLbyHBv5EGkHAGC3WU4T7SDoV4HnX6EY+fLF4sc41bBjYKVsT14TtDvd5Ylzxol6h/c19RaTexoql5L7neMrvh+1WU5Th7bFi5VjKIu0A4BjyR0VpLc+ht175snBIfmurpR9SmyonNBQOUCPR2UQtSTSDoDIFib3NFTavc1lrs3nPFcMe0OL64rgSHI/nq1C6Dd2AEzunSC99KG8IrTT6xy38BlDwN49ov755mDjJ5ExTO5pcMazlUu99kD3k/s1ikRSc2X46/FsdbdZTl04lpF2ACi2v+Mc12a8BkPJw30ZaL+hhwmpOa5vtUlE59mBDd/Uc0zuaYicSu4dSUgvtllO38azVQK784fruINyQ4ks1Gh7ca86WHlp7hrdHEoeawfQE9+4zzRR78wNbn1H5CSulk9DFGoHUOLCavMmuJBM3ktyrcmFhqOnrq7hQI09stfeiMdtnsWGy0wNlhUaLItoKF62eZZoB0FkG5N7GpTxbDWBG/Oh9zrda78nK9U/aMcB/eTahWG8iXYApGIHN6aEdN0LeByJ+siF72ci65jc09BE2gEcSLUDMCjRDgCKX97ScHSj9fnildvfDdYdh5s29gIg5HG0QntUFQ1b10Y1TbQDoO5ick9DE2oHUPLi2N7sjWyW0xRF5VjTjSTZGiKlzy1LtAMgFX90rOLqoi4l9p52ABcw2fCZGyyL+m+Hdhr+TT47NBcopo5jck+DMZ6tPOj3rJYl2gFY4MLc+2hgn7vHVYCH6YHzSBt7gP3E3uQ6GC5NLdOQawdAnbJoaes7o2vdBJ7vmSyPhoOr5dOQaM/HPpRqB2DaZjlNxrOV9rZ4EVoeni/bK2q3tK+5/d3gPGzzLNIOosN2KFbPTlr4LKP3ZuD5Xlf26g48P9SOgZzwpPCZb+huo7cHNmTRBZjc05CE2gGUvPZ4RfMFdLcQG41nq6jluedRi591TKwdALXqz22edbXS6oIHAHGLCbLpz/EslGmLZ7IwTkHppm2ehdox2LTNszTwfJNFhuhhJxDZx2H5NAiyRdpn7ThKerFK/hEuJBytjdKQ6R7a19ZTn9ZvoEo7AFMm9hd7AvBpm2dRmz3fFj4rNFyeTSbXQdkZLIvINJPXJxfVo4swuaeh4JD8lsjQcO1t8T5L0t0GF64tJnrD8AjA2+ZZnxsHbXrY5lmo2PNrclhylyr+JmPt64g36geT12dosCwaECb3NBShdgAlu81y2vfKuQvJZltJt/beua8DuJ6G7hVFbz23u2vmPvB8zaQ4N1hWaLAsawLPvwJwa7BIJvfkMpPX50j5eUUdxeSehsKF3tW93idisp6AxuI5ZdaT7vFsFUJ/5epY+fPJnlcU29yxt94czYZH0xX/0GB5toSGy2NyTy4zfX2GhsujAeCCetR7koBpr2RelmoH0JIEZntsznU9nq3CzXKaWvyMyGLZdewwgMaiAXoEkPQsof90we9coXiOmHx+3waerzU033TF/w7uf5+Yblhnck8uSw2XF8GNkZAfUnyWUgUm9zQELvXaAwNJxmRbvBi6PdsRLFV+ZZFG7Wsr4fZ3vbBDcZ2uAaz7OPT+0gpg4Pk2dt9YQGHOuoXVtO+gPy3oFJPPyN02z5jck7O2eZYHnr+DuQbJm8DzJw5f9+vA83MUW4qmyrGQ4LB8GgLtBKzsaWDJWKL8+XeShFspG/ojQpxt0acP7VBMV3kE8A3AFIC/zbMrmU+f9DGxb2gB8yuk3wSeHxkus65Hg2VdB57v0vfbT+QYm3xGpgbLIrLFdAeOkw14sh7ACMANgH8Cz18Hnu+pBkUA2HNPPTeerSbQnxNdNohe+5IFii8mrSR4hCIJTyyUrf2F+8jt76x66vu+zF2wzbM3S733MXQaH1OY3TpzDne/V0w/I139O4nKUgD3Bsu7Dzw/bnPrzpqig//+DCCU5/WCDdV6fpNhs+SozXIaa8fQcaF2AAcGVTnZLKdv49lqDbNfdOeaw3AlXrbZuzFZ5gXYa09DsUBRkTTZUHstFebYYJl1rAH8ZbA8zTUEjpLF/kw/Iwf1/UmdtQbw3XCZMfTX+Dn00aihEYqG2Eier0m7IRFQ9Nybbg0ns2LtADou0g6g5GWgPa0xdJP7m/Fs5Rk+9tq99i+WFwokcob03scwX2GeB57fag+TzMl9gdnEN4Z7DdmmGx+f2BNIXSDPq0eYHaFzL88qJ+bey5SbqsbWawDf5edi1xof+45z7qm3ZK61du9qWaodgAZJqvu2LZ72PFf22tOgSA/Qq+FiR9BpqEsMl3fr0tz7wPPnMP/dmxguj8gmG6NMEgtlXiqu+XO3KObjJ4Hn21r/iA4wuac+c6ayIxLtABRpJ6ORqYLGs9UddNdx2G2W00Tx84m02EjEvyosApXYKNOFxaxkka3YcLHc8pO6Zg07C4Fq16X2jXfn1oHuAeQyAoss44J61GcuJfe7zXLqxHAqDZvldD2erV6hlxSPxrPV3WY5NVFBjAyU0YT6lzuRhm2erQPPf0LRG2RSjBbvaxm2+wCz05VGKBKK1rf425OeuQTmF1CtvT2kNC6YfEbeWZoO4Fkokxwh97iN9Ya+BJ7/rDWXXe6vS9cMGaFoTI1QbJ3HBjtLmNxTn5mc79QUH2JFBdr0nNlzRGh4HmSqh/Z1lSh/PpGmGMA/hsvUmM+awHzF/ybw/GSbZ5HhcutKYGcqXHzGz17BbOPPBHam1Lm0iw/ZEcPOekPfA89H2wm+NN6lBoq6BrCShtq5K+sI9AmH5VMvydBplzC5tzNM7RyfDex5H5kIpIGHgS7KSAQAkIWZbKzh0eqIGIt/x33g+YmFco8KPP9KPtNGw+eTg1uANSK9nyYxOXKQXLcPlorfL1bXCpnyk8LsqJxbsG5sBZN76iunkntDw8E7bbOcvkG/1zlq+Pvaq+RzSD6RnfvwVrZva1Nsqdz7wPPTNhawKvXm2doRJbZUbl2hhTJNJ/fcRcBdscWyv7cxB1+ei8/QH5VDNXFYPvXSZjmNoN/LSr9aAPii+PlzXJggj2erCXSHUj4Ned0Gor1tnj1bmLMOFM+G1uasb/MstbSGAKTMPPD8O1vbUMkK/QnMz7Hfe7wgdtPPyDuYT0BCk4VxmzF3ydaXNp5Ve18k+Z6bvg6k4W4Oe1umv2qtHdB37LknotbIkPJHxRCuJUm/hHavfaL8+UQuiS2UedPmUFdh8/NGKLahSk0OBQ88Pww8PwWwgr3EHrjgmWth8bsbk7sQSMJkMtEzvT0kmRfD7pTEG7xvN9f4PpdpNnMAOewl9gB77a1hck9EbdMeWn52hVHm6mtO9Xjl9ndE7yzOZ40tlHmU/B3fLH/MLYB/JcmPLhmuLxX+KPD8ZxQLGtoYbVD2rcFc+xeTgcDsNWG6kTg1XB4ZJtdxG/WeexT3+XPg+fNzEn25v+9k7YwcxYr4Nhvunthrbw+H5RNRqzbLaTqerV5gZ/5WHXfj2epK1gCo/Tuw+0V3SqL42USumsP8vXkdeH68zbPYYJmnLFD04Nue9nMrr++B57+gSAxzHB/KPkGxZVuIdp/XLw2Pv+n5wfeyC0HapBAZAcDkfoC2eRbLNJY27qMbyHZ1gefvUNwPubzKrvB+j7c95VB7JGSvMbknIg0L6G2LN0KRECRn/E5kJZJ6dtAf7UDkHNlLegHzQ0fnsjVeKwuVyd9xB+DfNj5P3ECvgfWUqOHvpzA/x3kdeH546bZdMlpiDfONxJ1ZrFemcnSBre3ZIphfcf6UEd4b9Vzxjdvf2cXknohat1lOk/FstYBeb3iEmsn9eLbyoPvFuD5zlAHRkCxQ9AKZfJaMpMzYYJmVZJHAPyE9bgP2p4GKf2oikAMjAOklCxSWdhQw3Zjy2FYDlCEuJZhVrOwyIff4HHodGy5oOiqHauCceyLSotkbfStJex3aw8di5c8ncpYkNzaeJV9NLqRWxzbPFrC3L3YXPMgxaETmOJuedw+8L1CY1Lk2ZB5zjGI4tI1REomFMskimWc+1Ht8B8e2qe4r9twTkZYEdldiPWWOeom75pfRk+wwQERHyHzWCObnjcZof0rOHMU8WFeHzNvyArMNqQnsjYK4RzEPf79uwX5O816I4hyGsDc67XWbZ50Zkk/vtnm2X9Tys3YsLdoBCBsskklnYM89EamQpFWzBftk0j6ere6gu7c959oT1RNbKPPe5BZydchIhBB2ep5d9YKi4m9yiHkCu9uPAUUDzBcUw6z/Kb2+okjcbE47iy2WTfZFGNY9bmsdA/oAk3si0pQofva1JO9VtLe/Y88MUQ0y3NXGnt+tN7ANLMG3kdjvj2Ffn58v3Eas2wZ2j//B67VdTO6JSM1mOU0BPCmGcDR5l73tTa+4fI5Y8bOJusjG+hi3geeHFsqtNJDKv5XEvmQO+733GrTXgSEDSvf4o3IotuzAxF4Fk3si0pYofva9JPEfidoM5MAO/e11IrJC5iDbaCxUmR7T88r/I+wm9vvjF9sqX8nf567WT+7a5tnbNs/u0L9F9vZz7BPtQIaIyT0RqdospwnsDKetKzrz/7ch4fZ3RBeJLZR5Iwv2ta5U+f+m8fmWfNvm2V0b27jJ6vt9Gf3wss0z9tr30DbPIgB/oB8jTV4AeJxjr4fJPRG5IFH87Ojwf4xnK+3VqrmQHtEFpFfTRu99bKHM2mRv6E/QbQht6hXAJ4V9ru/Q/aRph2IUB/WU9HJP0O3GqG/bPJu00XBHxzG5JyIXaCazN5LMl2n2jjxy+zuiRiILZV7LnuVqpOFiAuBvzTgu9DeAicaQctl+K0R3E/z9EGcmTD23zbN8m2cTAH+iW9frE4DfFRru6ANM7olInQxB15xzdpjMa66Sz157ogYkmbPxPJnL/tRqZJj+HMDv0F2MtK59pX+umZzKEOEuDmnfJ/Yc4jwgMp3Eg/tz8V9RLJrHa9QhTO6JyBWx4mf/SObHs1UEu/sTV3mRHQSIqJnYQpkjOJIgbvPseZtnIYqh+i4m+U8ohuA7U+mXYc+/ozs9oi8oRjs4cfyoXdKQFwHwUST5Ll23+6Te46J57mFyT0ROkKHoWpXUkST1gO5Ceuy1JzJAeu9tDF//Gni+Z6Hci2zzLJUk/3foJwA7ieF3SepTxVg+JIlyCPfnNT+g6LHPtQMhXTJUP0LRk/8ndK/dRwBTJvVu+007ACKikgWAW6XPvhvPVqni5+9k5wAiMiNG0VhneiTOvlxnSNIaybSBO3l9buGjdwBSFFt3rrswL1yO1UTWUPiqHM6hVwBz2daR6Ae5txYAFtLAuL/PbdZZOnd/E5N7InLIZjldj2erV16RLtYAABlnSURBVADXCh//GYDmFxd77YkM2ubZW+D5C5hP4O4Dz1+4OFxaKt+JvBB4foiipzpEsRhf04aOHYBnFBX+1MXe+bq2eRYHnr+GbqPy3k7iWDCBolNkRMc+0b9CcW+H8k8Pl+/28wQgh9zjLj7j6DQm99RL49kqhkPbxmyW01A7hg5ZAPhL6bPvlT4X0N0OsC9MVkSGXqnJ4eZc7nMtYOe74A4duEYk+U73/11KBPb/3Nv/P6Bo5Cz/bc/7/9e3xHM/TF8aQeZoZ7RD2SuKZ7+LSX2qHYCSXDuAc8h1k+LgfJXu9TplpCd/aFg6XZf4z//5v//vv21/KNW3WU7/o/G5khy7Mlzt07mLjI1nqxDAP1aiucwfHHJdz3i2ukLx5aq1qJ2Gh81yGmkHQUQ0ZKXhzhEu7/08ZYf3Yc4cfk9ERnFBPeolaQxwacGcWDuArpBt8YZW4eGQfCIiZbJ42UL2GvcB/IFiYcYmo1heUSxE9g3FDgJX2zyLmNgTkQ0clk99tgDwXTsIcT2erUJuc1ZbDN0h8m162iynzg/vJSIaEpnXnJT/38FQ5/JUhrL9NIY3zlkmorYxuafe2iyniUwv0Fic7SNzDHcO21k2y2k+nq0e0f78Rw2JdgBERHRaaX4zwO9zInIQh+VT3yXaAZR8Hs9WnnYQHTKEoeqvXIuBiIiIiExgck9951qCGGsH0BUyheFVOw7LEu0AiIiIiKgffgPwSTsIIls2y+nbeLZ6gDvzt+/Gs9WVLBpHp8VwZ90EG1xrfCIiIiKijvqNC3zRAMRwJ7kfodhih0ldPWsUx6qP2+I9sJGHiIiIiEzhsHzqvc1ymqPZNjamzbUD6ApJfvvaEBJrB0BERERE/cHknobCpQTxejxbRdpBdEiiHYAFT9LoRERERERkBJN7GoTNcrqGW4uzRdoBdIUkwQ/acRjmUmMTEREREfUAk3saklg7gJLb8WwVagfRIYl2AAa9SmMTEREREZExTO5pSNYAdtpBlETaAXSFLPz5oh2HIey1JyIiIiLjmNzTYDi4ONv9eLbytIPoEJfO3aV26NcoBCIiIiJyBJN7GppEO4ADkXYAXbFZThO4tW7CJRJuf0dERERENjC5p0FxcHG2+Xi2utIOokMS7QAa6sPoAyIiIiJyEJN7GqJEO4CSEYA77SA6pMvJ8SO3vyMiIiIiW5jc0+DI4mxP2nGUxNoBdIUMaXdp5MU5utwwQURERESOY3JPQ5VoB1ByzW3xztLFJPlVGpWIiIiIiKxgck+D5ODibLF2AF2xWU6f4dbIizpi7QCIiIiIqN+Y3NOQJdoBlNxyW7yzJNoBnGEnjUlERERERNYwuachW6DYd9wVsXYAXeHgyIsqXZxGQEREREQdw+SeBksWZ1trx1Fyx23xztKVpDnRDoCIiIiI+u837QCIlMUA7rWDECMAc7AHv64ExbEa6YZR6YHb3xEVAs+/AjA58na+zbO8xXAGIfD8EMDzNs/etGMZCh7z/pJz+5G3bZ49txkL0THsuadBk8TLpcXZIu0AusLBkRcfSbQDIHLIBMA/R16RXlj9Eni+F3h+Gnj+f1Ec2/+R/z7WsEINBZ5/FXh+cnDMn3nMe+fY86srIwlpAJjcE7nVU349nq0i7SA6JNYOoMITt78jojbJ6Ig1gNuDt24BpPI+mZfi11GANyiOudd2MEQ0XEzuafAkAXNpcba5dgBd4eDIi7JEOwAiGpw7FEnlR0bgCAnjAs8/dcz5nU5ErWFyT1SItQMouRnPVqF2EB0SawfwgVduf0dECrwT79+1EcTAnBp6z6H5RNQaLqhHhGJrtfFstYA7i7NFKIb50Qmb5TQdz1avAK61YylJtAMgImpK5owfm0+cbPMsaTEcIiI6gT33RO9cWhDlfjxbedpBdEisHcABl64lIhqO/MT75y5CeoVivv5HL+/Msvrq1DHlKupE1Bom90TvEu0ADnCeXn1rADvtIMSDrORPRNQq6Ul/OfL2K9z7nus82QLt2NovO7Cxl4haxOSeSMjibA/acZRE49mKKxvXIMl0oh2HiLUDIKJBC/Hrd9kjgJB7r1tzh1+P+ROKY563Hw4RDRXn3BP9bIFft7PRMkJRYUiU4+iKBYAvyjE8SSMREZEKSeAjcGX81vCYE5Er2HNPVLJZTquG12mItQPoCkdGXnD4JRERERGpYHJP9KtEO4CS6/Fsxa2L6ksUP/t1s5yeu1gVEREREZERv41nq1Q7CDpus5yG2jEMjWyLF8OdrdXmOH+F40GSbfFeANwofDx77YmIiIhIzW8otjMhop8tAPylHYS4Hc9WHudy17YA8L3lz9zBrREfRERERDQwXFCP6GMJivnuI90wfojBhXpqkZEXC7R77hJuf9dNgedfAZh88NZz05XFA8/38Ote4Lnm6tlHYnqT7bzoA0eOWePrg9pTcZ9jm2dpu9GYFXj+BMDhzjpG7unA88PD/+fa8frg71d9xpr20fl17RyQW5jcE31gs5y+jWerBPqrr+/dj2erORPI2hYAvrb8eaQs8PwFjlfgw9LPXeF9ZeujUzgCz38FkAJY1K0oB54fodjlIsSRBqbA83dS7lr2JbdG/ta7GjEBxf7oKYq/Nz94v9axbZNUeqvWJEkuqeRLMr8/ZkdHN5bPI4pz6cTzWa5B76P3tnkWV/zeR+e4ajvW6KPk78DzNs/mJ37GuLrXvfzs/l+fADzL66zzeekxPyhjguPfJUn5WSHHPULx91Xd04844/qUa3+O4ph9+Gw89aw4l3xmdOTt9DCRleMU1YjxSWK86Dmg5Yy/b//9tN7mGadu0g9M7omOc2FrtbI5uHp+XQnaS+4fOWXCGROcmGoWeP7+PqozsuMaxdaY94HnPwGIjlUSA8+/Q/HMqLNWxwjAZwCfA8+PAcxNV84kuYlRVBLrjmK5kdeXwPMfAMSlv/fksVWQ4HjjzFPdpGpPKtUxinNTx4/zCGAhyfHCgSQ/wvFzFVf83rnn+BrurE0D4Md1P5fXuaO3bvH+93+Xez6u2Usa4bJjXnZVUUYK/NQAUPc8la/PeJtnHzYeSIIdo/5WwIfPinmD695D9fd1KjGGEmPdv31/Pr+eeS5VSANRjPr3VPn76RXF35dYCY46havlEx0hCdujdhwlkXYAXdHytnjste+IwPMTFGtpXDJl4xbAs1TAymVeSbkrXJboXANYSRlGSENDjqJx8tLpKfco/l4nd+uQRpFjif0OZzwv5RwuAPyL+on9oRGKBCV39Zj1nSS+zyjOg4lpWU41Zsl1leKyuEYA/go8P5EGkMNyn1E/sT90j+K6/3Bkjwlyf/6Dy8/JLYB/As9fHP792gLP9wLPT1GsFXRpY9k1igapVBpqaMCY3BNVcylxux7PVpF2EB3Sxrl73SynaQufQw1J8nxp5XVvhKICdSdlXqGobDctFyh6X5KmhUgleAUzyc0IRcNDZKAsY6TyWtXTF9cdhls6h6ZGaTl5zPpOenVTODaSwKAJzNzX9ygt/irXqYlyRwBSGwm+PBdN3Z9fUMTpRIJfalgx1ZC0b4S21tBC7mNyT1RBErcX7ThKWp+72FWb5fQZxZw7m2LL5ZM5JhLwvUQSzARmt128lx7pixiuBJd9x5H59kqSiveejg09PlRK7G1snfmdCX475F5cw8Iiqg4N4750RMmHZQWeH0tiaXJnmRGAteHEeQ6zz26guN/VE3yDDSuHrDW0UDcwuSc6zaXe+5vxbBVqB9EhicWyd5vl1Gb55K4RiqTQZIV77+slwyqlonhOJfgVRePXE4ph7Kc4sXOIrJlwrJer9nD8CxP7V5zX2PtjlAdZFaPe9fmC92u+/Kpz/ffNV9j5fryG2UbvOue1/Cyr6wYyl1/DicUTj3lB8bfWYaOhhTqCC+oRnaC0tVqVORS/lLpEzl0MO0M1XWr0ofO9QlaRhmydJEn1fgX2U4ly1TW1X6E6RzHk8grFolF3qLfAXYzz5oxPUK8H7glFhf6XlbNLK8TP4ejQ5tKiX8fUHo4v5ZxK7F9R3Ofp4W4JEkuI4nhVlZMEnu85sMjeSR/teiDD3f858ivfzl200DQ5D1X36hOKRQ4rF6wsbZUXorgPbmB/5FdT++fM8zbPnkt/w36XgFP38bHn0EfPxhDFMyzC6SHkXwLPb7yK/glPeL83D59l+9XmI1Q/a28kzlZHRMp5qjPSZP+8Tj/YvWR/nqsWjryW32cD48AwuSeqZ4F2t1ar8nk8W3lcob22BHbOXWKhTGrHh0mJVKByFD0eCc4f6ntsRf03KTeVYfcLVCck94Hnn7P69KmGpp3EdTTBkZgXKFbVPmdHgTYlOB7TOcPxJzg9feHPqvLkeCUokveq4zWS9zilyo6w4r3HbZ7VSmzkXkvlFZca+lz0AuDu8DlT/htqPmcO7VA0kP1y3ZemJyQyGiVB9fNhv3uIaa8onmXpsR+Qhri5HIME1SOsvgSen9Td6tSQUw2odf/G5/0OHTh+nj8Hnh86NL2EWsBh+UT1uNZLy4pifQuYH3b5wMaVzvpUp7dRKkMh6l87D9s8C0/1Vm3z7G2bZxFO78RRKymRHrWqnrQdgPCcrfakch/CoeHKklA0Ho4v4or3dgB+r9tQANQ6Xl84PNYar+K9i78nt3mWO7p3+MM2zyZnPGfq7hqzf06cvO7luJx6PkU1P/ccLwAmdRNVOQZ3OH0MWqvflbZqPOaSvzFC9d8Y142P+oHJPVENm+X0De1trVZHNJ6tWFmsQc6d6UpaYrg8asef5/RgSO9IXONHX6SCdY4I1clz3V7Dqs/dV9jP7pWS3wnhQIIvFeKk4kfOWR3fQ3VPXtTgeMVV5Z5bJjVjeVi4hhec32AxR717+O6c616eo98qfsT0IpUvKJ5lZ09vqZH83ra4fVyE4yMe9s/rS//GY9NI2vz7yAFM7onqi7UDKBmBlcVzxAbLeuL2d530ek5v7J78zqnK8dk9hFKBSyp+5GRyL0lv1bDbuMlw0zMaN2xLYGA4vqjqcXxs0lsrcRxb8IrzXlsm0yX65JypOgBqPWeA4h5KL4inslwZVWRK1HDdilONHG1dK1FVDA3/xqqy+fwZECb3RDXJMGyXFtjpW8XFGsPnLjFUDrWrydDLqoTvtcF8xqYjSsKK9y5qzDh0ImG1ThKEyp72M4usquSaGJ57rAxT+1jTz9KK9/6SLd/6MMqtyXMmOfH+Rde9jIxoY6vgh6Zz4iVprqozhU3Kr0Ouw2MjGl63eZY0Kf/E+QiblE3dwuSe6Dwuzb2/Hs9WbI2tz8S5e+X2d52VNvjdvOK9Jj296aW/K6p6901ORWnjuecFnh8evlCdmHy7YOj10Xn7hhadOpqEcN9p8+ScVfXIfgWQB56fBJ4fdfgcpJf+4qnEuOHaAmmD363L1POn6u80PY3gI2HFe6mhzzj2N3qGyqcO4Gr5RGfYLKfr8Wz1Cne2iprD/HzyXjJ07hJD4VDLGvb8VP1uk2GUTbWV3KcGyzrmHuet7P1y7jZspxK7wPPTc8q7QB96kF10ajebEUrXV+D5QDGSK0Vxbz93YH5+rh3AEbaff6+mVrLf5tlb4PmPODISqIVV5aueP6Gh54935P+30XhBjmByT3S+GPX2lG7D7Xi2mmyW0za3cemyBYC/Gv4+DY9mAl/laLJospIqe2ibKs6U6ILfqUquR+DQ+a5a4H1v+rpuUTrfgee/oGi8XXcg0R+S1HB5z6ie5qPlGu50GlHHcVg+0fnWcGAF6RLOva8vweXn7kFW3icaIrV59x/4u+V9qclhMp86QrNr9AZFw28mQ/g5ysINeYvlhYY/61BXp4RQxzC5JzqTJHiJdhwl99wWr56G54699kRuuGPyRWXS2DMB8GiguHsU8/SZjPVPrvjZfGZRK5jcE13GtUSPvff1XXLunjj1gQbOpSGj13DvGUzKtnn2ts2zOwCfUL2veR0jACkT/N6pOp+2R+allsuv4tJoU7KMc+6JLrBZTvPxbPWA8xaAsmkON/ajdp6cu6OL6hzBRIJcdLQyanJxqJYSnP0CZ2VXAL4c+fn7wPPXDVf6LtuheuFEE9hA2AK57lMAkey4EKJI6iY4r5FqhGKkFxN8PaaPvVfxnub9+Qq7owr47BkQJvdEl0vgTnI/Gs9WEbdpq22B+sn962Y55Y4E5KKqxaEmMNdTFBoqp0r60er3spDfsQQ/CTx/UncBtG2epRULA75t8yysUw51RynRB/Bjr/EJims6xOlFFG8Cz4+a7kFOFwtbLM92z31e8d56m2ccgUlGcFg+0YU2y2mKorfJFbF2AF0h567u4kvstSdXVfXGmKwoalY6YwAvR94b4fwt/46VdS29vNRjMnQ/3eZZLI05PoBvJ37tzn5kdMQo8PzIREGB53uo2FGhhUU6q8qPLH82DQiTe6JmEu0ASq7Hs1WoHUSHxDV+Zge3zjFRWVrx3rWJSrGUoTbfvrQS+jE3gefHZxSZVrx3TjnUA9s8y2XEyB8VP+a1Ew0dYapxMa54z3pHjTQeHOtUGAWez557MoLJPVEDMgzepS2i+OVQk5y7U4vMrLn9HblKEt+q1cHjJqvKy++qj1yRSvGfFT/y9Yxe96TivVtWsIdJht0fS/CO9vZSK26a3pfyfKiaRpk0Kf8MVSONYi7gSCYwuSdqLtEOoOTzeLbytIPokFOJS9xGEEQNVF3D1yhW/D47wZffSVEMfVe3zbMFqnvXau1NLg0FVeX8ZXAY8JWpshzFRITacvF9KQlzVVK9O/G+SVXP6xGAtUwfaCzwfI9TjYaJyT1Rcwu4tc1IrB1AhyQV7z1ultO8pTiILiILhlUlqzc4M8GXymUK93os73D8WXuN+g2t8Yn3vweef/GoB6lUJygW0Pp+SRkOySve++xCT6Mc70bz4uVce0fedml03pB9P7cHX67PFNWNlAsZBWWdLP75d8WPXAN4bnI9B55/F3h+CiADR3MOEpN7ooZk2LZLq6nfjWeri4fiDokk78f2Q1YfjkxUU3zi/RsAeeD586qEVXqaYxQLP7mW2NeZf/+5TuVfGkRO7YP+FUUlO67TkxZ4/kSO7zOKSvU9JKFwIQG+lCQjVY3Xyam/z1RPZIU7AKvA8/PA8xfn9lbKPZHg+NoS3EbMHX8Fnp+eOselBrZ/UZ3Y79D+d32M6ntqhOJ6TgPPj+o0MgaeH8q1nwNY4X0XCK9hrNRB3AqPyIwYDm2Lh6ICzOS0ngS/nrtXWVGfyHmyxds3FAnpMSMAf6GY15ni14QlxOltwdRt82wdeP4Djj9v48Dz0xorX89RDCuvasS4RnFMvwaev9+H+hnvW2ZNAFzh9HHz0O0EcY3jx/sGwL+B5z/i42tqIv8/tBUcinMAFOfrC4AvsuXhE4pzluPn87b/nYm8Tm2LmhqLlEy4BfCP3JMpfh1dcof6jZNRW732e9s8e5PGiX9P/OitvL4Hnv+C4vpN5b399XuF6r/VuUZaso/JPZEBm+U0H89WT3CncjwHk/taNstp+sG5i5XCIbrINs/2PcynGhlHKJKZUwmNy+YoksWPelpHKHqTw6pKu1Sw71AkfXXWFbiW1yXP+FNzfl2X4PR1VXVN2f5eDCs+t+lnc8cUd12jWafK39s8U7kvt3n2HHj+H6g/bWefpJ99PQeeP2lhmz9yCIflE5kTawdQcj2erSLtIDokKf17m4vrEJk0R/Xq+Zd6QAtbRdUlSXvVnNQb1Hgey5BzD8CLibgqdHZYPvBjGkOj68ry0Hyb09Ba79mlnzzCzppGD9s8U52PLjs0TGF/zSbPcvnkGCb3RIbIMG6XFt6JtAPoioMtDRfc/o66aJtnb9s8u0P1gk3netjmWWSwPCOkJ+pbxY98qbMolSRuIcwes0N9eJ5EaNYI4pkJ40O2hh7/odWzSz/sp3SYTID/cOWZJtdXCLsNjFyDaWCY3BOZFWsHUHI7nq063WPUsuTgn0SdJD1Sn9CswrgD8KcrleCPbPMshpnt8d5Kx8zkCIUnAJ9cPoZ1lRpBLj0+Nr+LTi2OeK5XAFPpWSVl0pA3QfN78wnA766d122ePW/zbALgD5jrINqhuC981/5eso/JPZFB0gPs0rZ43AalvgWAB25/R32wzbNUKoxTnDek+hXAnwA82VvedRGOP3NHOGOKjRyzEMDvKHryL6lov6AYUeBv8yyUIe29II0gIYok5JyGox0sjl6QxpP/jSKuJsO4X6SMCXvs3bLNs1yuvU84f4rIA4pGttDluefbPEu2eebh/Zl9yXX8iOIa9rZ5FsnUIxqY//z3v//VjoGIiIgskxWawyNvPwN4ZmXwZzJXfL+q+n6F6r03vK8Qn6I4fn0Ygl+LHJsQxZD7/fEB3lf0zlEck9YTKonNw/v1vv/vslT++QwgHdK5c4k8l/458vY3GaFz+Dv7ezHEr/flfmeEtOuNa3Js9veWh5+v4bz86vrfSuYwuSciIiIiotZdktwT0XEclk9ERERERETUcUzuiYiIiIiIiDqOyT0RERERERFRxzG5JyIiIiIiIuo4JvdEREREREREHcfknoiIiIiIiKjjmNwTERERERERdRyTeyIiIiIiIqKOY3JPRERERERE1HFM7omIiIiIiIg6jsk9ERERERERUcf9ph0AEREREREN0jOAT0fey1uMg6gX/j9C2sczF9e1QwAAAABJRU5ErkJggg==';

const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 2,
}).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const dataUriToUint8Array = (dataUri) => {
  const base64 = String(dataUri || '').split(',')[1] || '';
  if (!base64) return new Uint8Array();
  if (typeof atob === 'function') {
    const binary = atob(base64);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  throw new Error('Prohlížeč nepodporuje dekódování obrázku v dokumentu.');
};

const replaceTemplatePlaceholders = (templateContent, placeholders) => (
  Object.entries(placeholders).reduce((content, [key, value]) => {
    const replacement = String(value ?? '');
    return content
      .replace(new RegExp(escapeRegExp(`{{${key}}}`), 'g'), replacement)
      .replace(new RegExp(escapeRegExp(`{${key}}`), 'g'), replacement);
  }, String(templateContent || ''))
);

const stripHtml = (value) => String(value ?? '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<\/(p|div|section|header|footer|h[1-6]|tr|table|ul|ol|li)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#039;/g, "'")
  .replace(/[ \t]+/g, ' ')
  .replace(/\n\s+/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const sanitizeFileName = (value) => String(value || 'dokument')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'dokument';

const downloadBlob = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName;
  window.document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  window.document.body.removeChild(a);
};

const createStableHash = (value) => {
  const input = String(value || '');
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(index);
    hash &= 0xffffffff;
  }
  return Math.abs(hash).toString(36).toUpperCase().padStart(6, '0').slice(0, 8);
};

const buildOriginalDocumentId = ({ type, number, id, title, issueDate, generatedAt, version }) => {
  const readablePart = sanitizeFileName([type, number].filter(Boolean).join('-') || title || 'document')
    .replace(/-/g, '')
    .toUpperCase()
    .slice(0, 18) || 'DOCUMENT';
  const source = [type, number, id, title, issueDate, version, generatedAt].filter(Boolean).join('|');
  return `EKV-${readablePart}-${createStableHash(source)}`;
};

export const buildDocumentGenerationPayload = ({ opportunity, document }) => {
  const sourceItems = document?.items?.length
    ? document.items
    : (opportunity?.items?.length ? opportunity.items : (opportunity?.opportunity_items || []));
  const generatedAt = new Date().toISOString();
  const totals = calculateCrmTotals(sourceItems);
  const documentType = document?.type || 'offer';
  const documentNumber = document?.number || '';
  const subject = document?.subject || opportunity?.subject || {};

  const items = [...sourceItems]
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((item, index) => {
      const calculation = calculateCrmItem(item);
      return {
        position: index + 1,
        code: item.code || '',
        name: item.name || '',
        description: item.description || '',
        quantity: calculation.quantity,
        unit: item.unit || 'ks',
        unitPrice: calculation.unitPrice,
        unitCost: calculation.unitCost,
        discountPercent: calculation.discountPercent,
        vatRate: calculation.vatRate,
        commissionPercent: calculation.commissionPercent,
        lineTotal: calculation.total,
        taxTotal: calculation.taxTotal,
        totalWithTax: calculation.totalWithTax,
        marginTotal: calculation.marginAmount,
        marginPercent: calculation.marginPercent,
        commissionTotal: calculation.commissionAmount,
        profitAfterCommission: calculation.profitAfterCommission,
        profitAfterCommissionPercent: calculation.profitAfterCommissionPercent,
        customFields: item.custom_fields || item.product_fields || {},
      };
    });

  return {
    document: {
      id: document?.id,
      type: documentType,
      label: documentTypeLabels[documentType] || 'Dokument',
      number: documentNumber,
      originalId: buildOriginalDocumentId({
        type: documentType,
        number: documentNumber,
        id: document?.id,
        title: document?.title || opportunity?.title,
        issueDate: document?.issue_date,
        generatedAt,
      }),
      title: document?.title || opportunity?.title || 'Dokument',
      status: document?.status || 'draft',
      issueDate: document?.issue_date || new Date().toISOString(),
      validUntil: document?.valid_until || null,
      subtotal: totals.subtotal,
      discountTotal: totals.discount_total,
      taxTotal: totals.tax_total,
      total: totals.total,
      totalWithTax: totals.total_with_tax,
      costTotal: totals.cost_total,
      marginTotal: totals.margin_total,
      marginPercent: totals.margin_percent,
      commissionTotal: totals.commission_total,
      profitAfterCommission: totals.profit_after_commission,
      profitAfterCommissionPercent: totals.profit_after_commission_percent,
      notes: document?.notes || '',
    },
    opportunity: {
      id: opportunity?.id,
      title: opportunity?.title || '',
      value: Number(opportunity?.value || 0),
      subjectName: subject.name || '',
      projectName: opportunity?.project?.name || '',
      projectCode: opportunity?.project?.code || '',
      description: opportunity?.description || '',
      originalId: buildOriginalDocumentId({
        type: 'opportunity_overview',
        number: opportunity?.number || '',
        id: opportunity?.id,
        title: opportunity?.title,
        issueDate: opportunity?.created_at,
        generatedAt,
      }),
    },
    client: {
      name: subject.name || '',
      ico: subject.ico || '',
      dic: subject.dic || '',
      address: subject.address || '',
      contactPerson: subject.contact_person || '',
      email: subject.email || '',
      phone: subject.phone || '',
    },
    items,
    generatedAt,
  };
};

const renderItemsTableHtml = (items) => {
  const itemRows = items.length > 0 ? items.map((item) => `
    <tr>
      <td>${item.position}</td>
      <td>${escapeHtml(item.code || '-')}</td>
      <td>
        <strong>${escapeHtml(item.name)}</strong>
        ${item.description ? `<div class="muted">${escapeHtml(item.description)}</div>` : ''}
      </td>
      <td class="num">${Number(item.quantity || 0).toLocaleString('cs-CZ')} ${escapeHtml(item.unit)}</td>
      <td class="num">${formatCurrency(item.unitPrice)}</td>
      <td class="num">${Number(item.vatRate || 0).toLocaleString('cs-CZ')} %</td>
      <td class="num">${Number(item.discountPercent || 0).toLocaleString('cs-CZ')} %</td>
      <td class="num">${formatCurrency(item.lineTotal)}</td>
      <td class="num">${formatCurrency(item.totalWithTax)}</td>
    </tr>
  `).join('') : `
    <tr>
      <td colspan="10" class="empty">Dokument zatím nemá položky.</td>
    </tr>
  `;

  return `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Kód</th>
          <th>Název</th>
          <th class="num">Množství</th>
          <th class="num">Jedn. cena</th>
          <th class="num">DPH</th>
          <th class="num">Sleva</th>
          <th class="num">Celkem bez DPH</th>
          <th class="num">Celkem s DPH</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
  `;
};

const renderItemsRowsHtml = (items) => (
  items.map((item) => `
    <tr>
      <td>${item.position}</td>
      <td>${escapeHtml(item.code || '-')}</td>
      <td>
        <strong>${escapeHtml(item.name)}</strong>
        ${item.description ? `<div class="muted">${escapeHtml(item.description)}</div>` : ''}
      </td>
      <td class="num">${Number(item.quantity || 0).toLocaleString('cs-CZ')} ${escapeHtml(item.unit)}</td>
      <td class="num">${formatCurrency(item.unitPrice)}</td>
      <td class="num">${formatCurrency(item.lineTotal)}</td>
    </tr>
  `).join('')
);

const renderItemsListHtml = (items) => (
  items.length > 0
    ? `<ul>${items.map((item) => `
        <li>
          <strong>${escapeHtml(item.name)}</strong>
          ${item.code ? ` (${escapeHtml(item.code)})` : ''}
    ? ${Number(item.quantity || 0).toLocaleString('cs-CZ')} ${escapeHtml(item.unit)}
          ${item.description ? `<br><span class="muted">${escapeHtml(item.description)}</span>` : ''}
        </li>
      `).join('')}</ul>`
    : '<p class="empty">Dokument zatím nemá položky.</p>'
);

const createCommercialItemsDocxTable = (items) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
  },
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('#', { bold: true, shading: 'F3F4F6', width: 6 }),
        makeCell('Kód', { bold: true, shading: 'F3F4F6', width: 14 }),
        makeCell('Název', { bold: true, shading: 'F3F4F6', width: 36 }),
        makeCell('Množství', { bold: true, shading: 'F3F4F6', width: 16, align: AlignmentType.RIGHT }),
        makeCell('Jedn. cena', { bold: true, shading: 'F3F4F6', width: 14, align: AlignmentType.RIGHT }),
        makeCell('Celkem', { bold: true, shading: 'F3F4F6', width: 14, align: AlignmentType.RIGHT }),
      ],
    }),
    ...(items.length ? items.map((item, index) => new TableRow({
      children: [
        makeCell(String(index + 1), { width: 6 }),
        makeCell(item.code || '-', { width: 14 }),
        makeCell(item.name || '-', { width: 36 }),
        makeCell(`${Number(item.quantity || 0).toLocaleString('cs-CZ')} ${item.unit}`, { width: 16, align: AlignmentType.RIGHT }),
        makeCell(formatCurrency(item.unitPrice), { width: 14, align: AlignmentType.RIGHT }),
        makeCell(formatCurrency(item.lineTotal), { width: 14, align: AlignmentType.RIGHT }),
      ],
    })) : [new TableRow({ children: [makeCell('Dokument zatím nemá položky.', { width: 100 })] })]),
  ],
});


const isPremiumOfferTemplate = (template) => /ekv\s+premium|premium.*nab/i.test(`${template?.name || ''} ${template?.description || ''}`);

const createPremiumOfferDocxBlob = async (payload) => {
  await ensureDocxModule();
  const { document, opportunity, items, totals, generatedAt } = payload;
  const safeTitle = document.title || opportunity.title || 'Nab\u00eddka';
  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children: [
        new Paragraph({
          spacing: { after: 100 },
          children: [new ImageRun({ data: dataUriToUint8Array(ekvProjectLogoDataUri), transformation: { width: 185, height: 33 } })],
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          },
          rows: [new TableRow({
            children: [
              makeCell('EKV Project | make it simple', { width: 58, bold: true, size: 26, color: '2459C7' }),
              makeCell(`${documentTypeLabels[document.type] || 'Nab\u00eddka'}\n${document.number || '-'}`, { width: 42, align: AlignmentType.RIGHT, bold: true, size: 22, color: '111827' }),
            ],
          })],
        }),
        makeParagraph(safeTitle, { heading: HeadingLevel.HEADING_1, bold: true, size: 34, spacing: { before: 260, after: 120 } }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          },
          rows: [
            new TableRow({ children: [makeCell('Klient', { bold: true, shading: 'F3F6FB', width: 22 }), makeCell(document.subjectName || opportunity.subjectName || 'Bez subjektu', { width: 28 }), makeCell('Projekt', { bold: true, shading: 'F3F6FB', width: 22 }), makeCell(opportunity.title || '-', { width: 28 })] }),
            new TableRow({ children: [makeCell('Vystaveno', { bold: true, shading: 'F3F6FB', width: 22 }), makeCell(formatDate(document.issueDate), { width: 28 }), makeCell('Platnost', { bold: true, shading: 'F3F6FB', width: 22 }), makeCell(formatDate(document.validUntil), { width: 28 })] }),
          ],
        }),
        makeParagraph('Rozsah nab\u00eddky', { heading: HeadingLevel.HEADING_2, bold: true, size: 24, spacing: { before: 260, after: 80 } }),
        makeParagraph(opportunity.description || 'N\u00e1vrh dod\u00e1vky dle polo\u017ekov\u00e9ho rozpo\u010dtu.'),
        makeParagraph('Polo\u017ekov\u00fd rozpo\u010det', { heading: HeadingLevel.HEADING_2, bold: true, size: 24, spacing: { before: 260, after: 80 } }),
        createCommercialItemsDocxTable(items),
        makeParagraph('Finan\u010dn\u00ed souhrn', { heading: HeadingLevel.HEADING_2, bold: true, size: 24, spacing: { before: 260, after: 80 } }),
        new Table({
          width: { size: 56, type: WidthType.PERCENTAGE },
          alignment: AlignmentType.RIGHT,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          },
          rows: [
            new TableRow({ children: [makeCell('Cena bez DPH', { width: 55 }), makeCell(formatCurrency(totals.subtotal), { width: 45, align: AlignmentType.RIGHT })] }),
            new TableRow({ children: [makeCell('Sleva', { width: 55 }), makeCell(formatCurrency(totals.discountTotal), { width: 45, align: AlignmentType.RIGHT })] }),
            new TableRow({ children: [makeCell('DPH', { width: 55 }), makeCell(formatCurrency(totals.taxTotal), { width: 45, align: AlignmentType.RIGHT })] }),
            new TableRow({ children: [makeCell('Celkem s DPH', { width: 55, bold: true, shading: 'ECFDF3' }), makeCell(formatCurrency(totals.totalWithTax), { width: 45, align: AlignmentType.RIGHT, bold: true, shading: 'ECFDF3' })] }),
          ],
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          },
          rows: [new TableRow({ children: [makeCell('Za EKV Project\n\n____________________________', { width: 50 }), makeCell('Za klienta\n\n____________________________', { width: 50 })] })],
        }),
        makeParagraph(`Vygenerov\u00e1no: ${formatDate(generatedAt)} | ID origin\u00e1lu: ${document.originalId}`, { color: '667085', size: 16, spacing: { before: 220 } }),
      ],
    }],
  });

  return Packer.toBlob(doc);
};

const buildItemTemplatePlaceholders = (item) => ({
  item_position: item.position,
  item_code: item.code || '',
  item_name: item.name || '',
  item_description: item.description || '',
  item_quantity: Number(item.quantity || 0).toLocaleString('cs-CZ'),
  item_unit: item.unit || '',
  item_unit_price: formatCurrency(item.unitPrice),
  item_discount_percent: Number(item.discountPercent || 0).toLocaleString('cs-CZ'),
  item_vat_rate: item.vatRate.toLocaleString('cs-CZ'),
  item_tax_total: formatCurrency(item.taxTotal),
  item_total_with_tax: formatCurrency(item.totalWithTax),
  item_unit_cost: formatCurrency(item.unitCost),
  item_line_total: formatCurrency(item.lineTotal),
  item_margin_total: formatCurrency(item.marginTotal),
  item_margin_percent: Number(item.marginPercent || 0).toLocaleString('cs-CZ'),
  item_commission_percent: Number(item.commissionPercent || 0).toLocaleString('cs-CZ'),
  item_commission_total: formatCurrency(item.commissionTotal),
  item_profit_after_commission: formatCurrency(item.profitAfterCommission),
  item_profit_after_commission_percent: Number(item.profitAfterCommissionPercent || 0).toLocaleString('cs-CZ'),
  ...Object.entries(item.customFields || {}).reduce((acc, [key, value]) => {
    acc[`item_${key}`] = value ?? '';
    return acc;
  }, {}),
});

const fillItemsRepeatBlocks = (templateContent, items) => {
  const replaceBlock = (content, opening, closing) => {
    const blockRegex = new RegExp(`${escapeRegExp(opening)}([\\s\\S]*?)${escapeRegExp(closing)}`, 'g');
    return content.replace(blockRegex, (_, rowTemplate) => (
      items.map((item) => replaceTemplatePlaceholders(rowTemplate, buildItemTemplatePlaceholders(item))).join('')
    ));
  };

  return replaceBlock(
    replaceBlock(String(templateContent || ''), '{{#items}}', '{{/items}}'),
    '{#items}',
    '{/items}'
  );
};

export const buildDocumentTemplatePlaceholders = (payload) => {
  const { document, opportunity, client = {}, generatedAt } = payload;
  const totalWithTax = document.totalWithTax ?? (document.total + document.taxTotal);
  const clientName = opportunity.subjectName || 'Bez subjektu';
  const projectName = opportunity.projectName || opportunity.projectCode || '';
  const values = {
    document_number: document.number || '',
    document_title: document.title || '',
    document_type: document.label || '',
    document_original_id: document.originalId || '',
    document_date: formatDate(document.issueDate),
    document_valid_until: formatDate(document.validUntil),
    client_name: clientName,
    client_ico: client.ico || '',
    client_dic: client.dic || '',
    client_address: client.address || '',
    client_contact_person: client.contactPerson || '',
    client_email: client.email || '',
    client_phone: client.phone || '',
    project_name: projectName,
    project_code: opportunity.projectCode || '',
    opportunity_title: opportunity.title || '',
    opportunity_description: opportunity.description || '',
    opportunity_value: formatCurrency(opportunity.value),
    subtotal: formatCurrency(document.subtotal),
    discount_total: formatCurrency(document.discountTotal),
    tax_total: formatCurrency(document.taxTotal),
    total_amount: formatCurrency(document.total),
    total_with_tax: formatCurrency(totalWithTax),
    cost_total: formatCurrency(document.costTotal),
    margin_total: formatCurrency(document.marginTotal),
    margin_percent: Number(document.marginPercent || 0).toLocaleString('cs-CZ'),
    commission_total: formatCurrency(document.commissionTotal),
    profit_after_commission: formatCurrency(document.profitAfterCommission),
    profit_after_commission_percent: Number(document.profitAfterCommissionPercent || 0).toLocaleString('cs-CZ'),
    notes: document.notes || '',
    company_logo: ekvProjectLogoDataUri,
    company_name: EKV_COMPANY.name,
    company_address: EKV_COMPANY.address,
    company_ico: EKV_COMPANY.ico,
    company_dic: EKV_COMPANY.dic,
    company_email: EKV_COMPANY.email,
    company_web: EKV_COMPANY.web,
    generated_at: formatDate(generatedAt),
    item_count: payload.items.length,
    items_table: renderItemsTableHtml(payload.items),
    items_rows: renderItemsRowsHtml(payload.items),
    items_list: renderItemsListHtml(payload.items),

    supplier_name: clientName,
    order_number: document.number || '',
    order_date: formatDate(document.issueDate),
    delivery_date: formatDate(document.validUntil),
    realization_name: projectName || opportunity.title || '',
    admin_name: 'EKV Group',
  };

  return values;
};

export const fillDocumentTemplate = (templateContent, payload) => {
  const placeholders = buildDocumentTemplatePlaceholders(payload);
  const cleanTemplate = sanitizeDocumentTemplateHtml(templateContent);
  const withItemBlocks = fillItemsRepeatBlocks(cleanTemplate, payload.items);
  return sanitizeGeneratedDocumentHtml(replaceTemplatePlaceholders(withItemBlocks, placeholders));
};

const ensureHtmlDocument = (content, title = 'Dokument') => {
  const html = String(content || '');
  if (/<!doctype html|<html[\s>]/i.test(html)) return html;

  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f3f4f6; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.45; }
    .page { width: 210mm; min-height: 297mm; margin: 16px auto; background: #fff; padding: 18mm; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12); }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { background: #f9fafb; color: #6b7280; font-size: 11px; text-align: left; text-transform: uppercase; border-bottom: 1px solid #e5e7eb; padding: 9px; }
    td { border-bottom: 1px solid #eef2f7; padding: 9px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .muted { color: #6b7280; font-size: 12px; margin-top: 3px; }
    .empty { text-align: center; color: #6b7280; padding: 24px; }
    @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; width: auto; min-height: auto; } }
  </style>
</head>
<body><main class="page">${html}</main></body>
</html>`;
};

const renderLegacyCommercialDocumentHtml = (payload, template = null) => {
  const { document, opportunity, items, generatedAt } = payload;
  const totalWithTax = document.totalWithTax ?? (document.total + document.taxTotal);

  if (template?.content) {
    return sanitizeGeneratedDocumentHtml(ensureHtmlDocument(
      fillDocumentTemplate(template.content, payload),
      `${document.label} ${document.number || ''}`.trim()
    ));
  }

  return sanitizeGeneratedDocumentHtml(`<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.label)} ${escapeHtml(document.number)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f4f6;
      color: #111827;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 13px;
      line-height: 1.45;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 16px auto;
      background: #fff;
      padding: 18mm;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      border-bottom: 2px solid #111827;
      padding-bottom: 18px;
      margin-bottom: 28px;
    }
        .brand-lockup {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-logo {
      width: 148px;
      max-width: 42mm;
      height: auto;
      display: block;
    }
    .brand {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .doc-title {
      text-align: right;
    }
    .doc-title h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
    }
    .doc-title p, .muted {
      margin: 4px 0 0;
      color: #6b7280;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      margin-bottom: 28px;
    }
    .box {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 14px;
    }
    .box h2 {
      margin: 0 0 10px;
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    th {
      background: #f9fafb;
      color: #6b7280;
      font-size: 11px;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 1px solid #e5e7eb;
      padding: 9px;
    }
    td {
      border-bottom: 1px solid #eef2f7;
      padding: 9px;
      vertical-align: top;
    }
    .num { text-align: right; white-space: nowrap; }
    .empty { text-align: center; color: #6b7280; padding: 24px; }
    .summary {
      width: 48%;
      margin-left: auto;
      margin-top: 20px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .summary div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid #eef2f7;
    }
    .summary div:last-child {
      border-bottom: 0;
      background: #111827;
      color: #fff;
      font-size: 15px;
      font-weight: 700;
    }
    .notes {
      margin-top: 28px;
      border-top: 1px solid #e5e7eb;
      padding-top: 18px;
      color: #374151;
      white-space: pre-wrap;
    }
    footer {
      margin-top: 42px;
      color: #6b7280;
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid #e5e7eb;
      padding-top: 12px;
    }
    @media print {
      body { background: #fff; }
      .page { margin: 0; box-shadow: none; width: auto; min-height: auto; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header>
      <div class="brand-lockup">
        <img class="brand-logo" src="${ekvProjectLogoDataUri}" alt="EKV Project" />
      </div>
      <div class="doc-title">
        <h1>${escapeHtml(document.label)}</h1>
        <p>${escapeHtml(document.number || 'Bez čísla')}</p>
      </div>
    </header>

    <section class="grid">
      <div class="box">
        <h2>Klient</h2>
        <strong>${escapeHtml(opportunity.subjectName || 'Bez subjektu')}</strong>
        <p class="muted">${escapeHtml(opportunity.projectName || opportunity.projectCode || '')}</p>
      </div>
      <div class="box">
        <h2>Dokument</h2>
        <p><strong>Název:</strong> ${escapeHtml(document.title)}</p>
        <p><strong>Datum:</strong> ${formatDate(document.issueDate)}</p>
        <p><strong>Platnost:</strong> ${formatDate(document.validUntil)}</p>
      </div>
    </section>

    <h2>Položky</h2>
    ${renderItemsTableHtml(items)}

    <section class="summary">
      <div><span>Mezisoučet</span><strong>${formatCurrency(document.subtotal)}</strong></div>
      <div><span>Sleva</span><strong>${formatCurrency(document.discountTotal)}</strong></div>
      <div><span>DPH</span><strong>${formatCurrency(document.taxTotal)}</strong></div>
      <div><span>Celkem s DPH</span><strong>${formatCurrency(totalWithTax)}</strong></div>
    </section>

    ${document.notes ? `<section class="notes"><strong>Poznámka</strong><br />${escapeHtml(document.notes)}</section>` : ''}

    <footer>
      <span>Vygenerováno: ${formatDate(generatedAt)}</span>
      <span>ID originálu: ${escapeHtml(document.originalId)}</span>
    </footer>
  </main>
</body>
</html>`);
};

const EKV_COMPANY = {
  name: 'EKV Project s.r.o.',
  address: 'Papírnická 2809/16, 326 00 Plzeň',
  ico: '10793615',
  dic: 'CZ10793615',
  email: 'info@ekvproject.cz',
  web: 'www.ekvproject.cz',
};

const chunkCommercialItems = (items = []) => {
  if (items.length === 0) return [[]];
  const chunks = [];
  let current = [];
  let weight = 0;

  items.forEach((item) => {
    const textLength = String(item.name || '').length + String(item.description || '').length;
    const itemWeight = Math.max(1, Math.ceil(textLength / 115));
    const limit = chunks.length === 0 ? 4 : 5;
    if (current.length > 0 && weight + itemWeight > limit) {
      chunks.push(current);
      current = [];
      weight = 0;
    }
    current.push(item);
    weight += itemWeight;
  });

  if (current.length > 0) chunks.push(current);
  return chunks;
};

const renderCorporateItemsTable = (items) => {
  const rows = items.length > 0 ? items.map((item) => `
    <tr>
      <td class="position">${item.position}</td>
      <td class="item-copy">
        ${item.code ? `<span class="item-code">${escapeHtml(item.code)}</span>` : ''}
        <strong>${escapeHtml(item.name || 'Položka')}</strong>
        ${item.description ? `<span class="item-description">${escapeHtml(item.description)}</span>` : ''}
      </td>
      <td class="num">${Number(item.quantity || 0).toLocaleString('cs-CZ')} ${escapeHtml(item.unit || '')}</td>
      <td class="num">${formatCurrency(item.unitPrice)}</td>
      <td class="num">${Number(item.discountPercent || 0).toLocaleString('cs-CZ')} %</td>
      <td class="num">${Number(item.vatRate || 0).toLocaleString('cs-CZ')} %</td>
      <td class="num amount">${formatCurrency(item.lineTotal)}</td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="empty">Dokument zatím nemá položky.</td></tr>';

  return `
    <table class="line-items">
      <thead><tr>
        <th>#</th><th>Položka</th><th class="num">Množství</th><th class="num">Jedn. cena</th><th class="num">Sleva</th><th class="num">DPH</th><th class="num">Celkem bez DPH</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
};

const renderCorporateCommercialDocumentHtml = (payload) => {
  const { document, opportunity, client = {}, items, generatedAt } = payload;
  const isOrder = document.type === 'order';
  const totalWithTax = document.totalWithTax ?? (document.total + document.taxTotal);
  const itemChunks = chunkCommercialItems(items);
  const longNotes = String(document.notes || '').length > 360;
  const pageDefinitions = itemChunks.map((pageItems, index) => ({
    kind: index === 0 ? 'first' : 'items',
    items: pageItems,
    isLastItemsPage: index === itemChunks.length - 1,
  }));
  if (longNotes) pageDefinitions.push({ kind: 'notes', items: [], isLastItemsPage: false });
  const pageCount = pageDefinitions.length;

  const documentContext = isOrder
    ? 'Potvrzený rozsah objednávky, ceny a termíny plnění podle aktuálních údajů v EKV Portálu.'
    : 'Položkový návrh dodávky a realizace podle aktuální kalkulace obchodního případu.';
  const itemSectionTitle = isOrder ? 'Položky objednávky' : 'Položkový rozpočet';
  const acceptanceTitle = isOrder ? 'Potvrzení objednávky' : 'Akceptace nabídky';
  const clientRole = isOrder ? 'Za objednatele' : 'Za klienta';
  const validUntilLabel = isOrder ? 'Termín / platnost' : 'Platnost nabídky';

  const renderFooter = (pageNumber) => `
    <footer>
      <div><strong>${EKV_COMPANY.name}</strong> · ${EKV_COMPANY.address} · IČO ${EKV_COMPANY.ico} · DIČ ${EKV_COMPANY.dic}</div>
      <div>${EKV_COMPANY.email} · ${EKV_COMPANY.web}</div>
      <div class="footer-meta">ID ${escapeHtml(document.originalId)} · Strana ${pageNumber}/${pageCount}</div>
    </footer>`;

  const renderTotals = () => `
    <section class="closing-grid keep-together">
      <div class="terms">
        <h3>${acceptanceTitle}</h3>
        <p>${isOrder ? 'Objednávka se stává závaznou potvrzením oprávněnými zástupci obou stran.' : 'Nabídku lze přijmout podpisem nebo písemným potvrzením v době její platnosti.'}</p>
        ${document.notes && !longNotes ? `<div class="note"><strong>Poznámka</strong><span>${escapeHtml(document.notes)}</span></div>` : ''}
      </div>
      <div class="totals">
        <div><span>Cena před slevou</span><strong>${formatCurrency(document.subtotal)}</strong></div>
        <div><span>Sleva celkem</span><strong>${formatCurrency(document.discountTotal)}</strong></div>
        <div><span>Cena bez DPH</span><strong>${formatCurrency(document.total)}</strong></div>
        <div><span>DPH</span><strong>${formatCurrency(document.taxTotal)}</strong></div>
        <div class="total-main"><span>Celkem s DPH</span><strong>${formatCurrency(totalWithTax)}</strong></div>
      </div>
    </section>
    <section class="signature keep-together">
      <div class="sig-card"><strong>Za EKV Project</strong><div class="sig-line">Datum, jméno a podpis</div></div>
      <div class="sig-card"><strong>${clientRole}</strong><div class="sig-line">Datum, jméno a podpis</div></div>
    </section>`;

  const pages = pageDefinitions.map((page, index) => {
    const isFirst = page.kind === 'first';
    const isNotes = page.kind === 'notes';
    const includeTotals = page.isLastItemsPage && !longNotes;
    return `
      <main class="page">
        <div class="topbar"></div>
        ${isFirst ? `
          <header class="document-header">
            <div>
              <img class="brand-logo" src="${ekvProjectLogoDataUri}" alt="EKV Project" />
              <p class="document-label">${escapeHtml(document.label)} ${escapeHtml(document.number || 'Bez čísla')}</p>
              <h1>${escapeHtml(document.title)}</h1>
              <p class="subtitle">${documentContext}</p>
            </div>
            <aside class="meta">
              <div><span>Vystaveno</span><strong>${formatDate(document.issueDate)}</strong></div>
              <div><span>${validUntilLabel}</span><strong>${formatDate(document.validUntil)}</strong></div>
              <div><span>Obchodní případ</span><strong>${escapeHtml(opportunity.title || '-')}</strong></div>
              <div class="meta-total"><span>Celkem s DPH</span><strong>${formatCurrency(totalWithTax)}</strong></div>
            </aside>
          </header>
          <section class="party-grid">
            <div class="party-card">
              <h2>Klient</h2><div class="party-name">${escapeHtml(client.name || opportunity.subjectName || 'Bez klienta')}</div>
              ${client.address ? `<p>${escapeHtml(client.address)}</p>` : ''}
              ${(client.ico || client.dic) ? `<p>${[client.ico ? `IČO ${escapeHtml(client.ico)}` : '', client.dic ? `DIČ ${escapeHtml(client.dic)}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
              ${(client.contactPerson || client.email || client.phone) ? `<p>${[client.contactPerson, client.email, client.phone].filter(Boolean).map(escapeHtml).join(' · ')}</p>` : ''}
            </div>
            <div class="party-card">
              <h2>Projekt / obchodní případ</h2><div class="party-name">${escapeHtml(opportunity.projectName || opportunity.title || '-')}</div>
              ${opportunity.projectCode ? `<p>Kód projektu ${escapeHtml(opportunity.projectCode)}</p>` : ''}
              ${opportunity.description ? `<p>${escapeHtml(opportunity.description)}</p>` : '<p>Rozsah plnění je uveden v položkovém rozpočtu.</p>'}
            </div>
          </section>` : `
          <header class="continuation-header">
            <img class="brand-logo compact" src="${ekvProjectLogoDataUri}" alt="EKV Project" />
            <div><span>${escapeHtml(document.label)} ${escapeHtml(document.number || '')}</span><strong>${escapeHtml(document.title)}</strong></div>
          </header>`}
        ${isNotes ? `
          <section class="section notes-page"><div class="section-title"><h2>Poznámky a podmínky</h2></div><p>${escapeHtml(document.notes)}</p></section>
          ${renderTotals()}` : `
          <section class="section">
            <div class="section-title"><h2>${itemSectionTitle}${!isFirst ? ' - pokračování' : ''}</h2><span>${items.length} ${items.length === 1 ? 'položka' : (items.length >= 2 && items.length <= 4 ? 'položky' : 'položek')}</span></div>
            ${renderCorporateItemsTable(page.items)}
          </section>
          ${includeTotals ? renderTotals() : ''}`}
        ${renderFooter(index + 1)}
      </main>`;
  }).join('');

  return sanitizeGeneratedDocumentHtml(`<!doctype html>
<html lang="cs"><head><meta charset="utf-8" /><title>${escapeHtml(document.label)} ${escapeHtml(document.number)}</title>
<style>
  :root{--ink:#101828;--muted:#667085;--line:#d7e0ec;--soft:#f5f8fc;--blue:#2459c7;--blue-dark:#153b82;--green:#2f8f5b}
  *{box-sizing:border-box} body{margin:0;background:#e9edf4;color:var(--ink);font-family:"Aptos","Segoe UI",Calibri,Arial,sans-serif;font-size:10.5px;line-height:1.4}
  .page{position:relative;width:210mm;min-height:297mm;margin:16px auto;background:#fff;padding:9mm 10mm 21mm;box-shadow:0 20px 55px rgba(15,23,42,.16);page-break-after:always;overflow:hidden}
  .page:last-child{page-break-after:auto}.topbar{height:6px;border-radius:999px;background:linear-gradient(90deg,var(--blue-dark),var(--blue),var(--green));margin-bottom:9px}
  .brand-logo{display:block;width:54mm;height:auto;margin-bottom:10px}.brand-logo.compact{width:39mm;margin:0}
  .document-header{display:grid;grid-template-columns:minmax(0,1fr) 71mm;gap:8mm;align-items:start;margin-bottom:10px}.document-label{margin:0 0 5px;color:var(--blue);font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
  h1{margin:0;font-size:24px;line-height:1.08;letter-spacing:-.035em}.subtitle{max-width:110mm;margin:7px 0 0;color:#475467;font-size:11.5px}
  .meta{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fbfdff}.meta>div{display:grid;grid-template-columns:28mm 1fr;gap:6px;padding:8px 9px;border-bottom:1px solid var(--line)}.meta>div:last-child{border-bottom:0}.meta span{color:var(--muted);font-size:8.2px;letter-spacing:.08em;text-transform:uppercase}.meta strong{text-align:right;font-size:10px}.meta .meta-total{background:#ecfdf3;color:#14532d}
  .party-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:9px}.party-card{min-height:29mm;border:1px solid var(--line);border-radius:12px;padding:9px}.party-card h2{margin:0 0 5px;color:#475467;font-size:9px;letter-spacing:.1em;text-transform:uppercase}.party-name{font-size:15px;font-weight:800}.party-card p{margin:4px 0 0;color:var(--muted)}
  .continuation-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:9px;border-bottom:1px solid var(--line)}.continuation-header div{text-align:right}.continuation-header span{display:block;color:var(--blue);font-size:9px;font-weight:800;text-transform:uppercase}.continuation-header strong{display:block;margin-top:2px;font-size:12px}
  .section{margin-top:8px}.section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;padding-bottom:6px;border-bottom:2px solid #e8edf5}.section-title h2{margin:0;font-size:13.5px}.section-title span{border-radius:999px;background:#edf4ff;color:var(--blue);padding:3px 8px;font-size:9px;font-weight:800}
  table{width:100%;border-collapse:separate;border-spacing:0}.line-items{border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:9.4px}.line-items th{padding:5px;background:#f1f5fa;color:var(--muted);font-size:7.8px;letter-spacing:.06em;text-align:left;text-transform:uppercase;border-bottom:1px solid var(--line)}.line-items td{padding:6px 5px;vertical-align:top;border-bottom:1px solid #e9eef5}.line-items tr:last-child td{border-bottom:0}.line-items .position{width:6mm;color:var(--muted)}.item-copy{width:70mm}.item-copy strong,.item-code,.item-description{display:block}.item-code{margin-bottom:2px;color:var(--blue);font-size:8.4px;font-weight:800}.item-description{margin-top:2px;color:var(--muted);font-size:8.5px}.num{text-align:right;white-space:nowrap}.amount{font-weight:800}.empty{text-align:center;color:var(--muted);padding:18px!important}
  .closing-grid{display:grid;grid-template-columns:1fr 71mm;gap:8mm;margin-top:9px;align-items:start}.terms h3{margin:0 0 5px;font-size:12px}.terms p{margin:0;color:var(--muted)}.note{margin-top:8px;padding:7px 8px;border-left:3px solid var(--blue);background:var(--soft)}.note strong,.note span{display:block}.note span{margin-top:2px;color:#475467;white-space:pre-wrap}
  .totals{border:1px solid var(--line);border-radius:11px;overflow:hidden}.totals>div{display:grid;grid-template-columns:1fr 29mm;gap:8px;padding:6px 9px;border-bottom:1px solid #e9eef5}.totals>div:last-child{border-bottom:0}.totals strong{text-align:right}.totals .total-main{background:#ecfdf3;color:#14532d;font-size:12px;font-weight:900}
  .signature{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:9px}.sig-card{display:flex;min-height:47px;flex-direction:column;justify-content:space-between;border:1px solid var(--line);border-radius:10px;padding:8px}.sig-line{padding-top:5px;border-top:1px solid #98a2b3;color:var(--muted);font-size:9px}
  .notes-page p{white-space:pre-wrap;color:#344054;font-size:10.5px}.keep-together{break-inside:avoid}
  footer{position:absolute;right:10mm;bottom:6mm;left:10mm;display:grid;grid-template-columns:1.5fr 1fr auto;gap:8px;padding-top:5px;border-top:1px solid #e8edf5;color:var(--muted);font-size:7.5px}.footer-meta{text-align:right;white-space:nowrap}
  @page{size:A4;margin:0}@media print{body{background:#fff}.page{margin:0;box-shadow:none}}
</style></head><body>${pages}</body></html>`);
};

export const renderCommercialDocumentHtml = (payload, template = null) => (
  template?.content
    ? renderLegacyCommercialDocumentHtml(payload, template)
    : renderCorporateCommercialDocumentHtml(payload)
);

export const generateDocumentFileName = (payload, extension = 'html') => {
  const parts = [
    payload.document.label,
    payload.document.number,
    payload.opportunity.subjectName,
  ].filter(Boolean);
  return `${sanitizeFileName(parts.join(' '))}.${extension}`;
};

export const downloadGeneratedDocumentHtml = ({ opportunity, document, template }) => {
  const payload = buildDocumentGenerationPayload({ opportunity, document });
  const html = renderCommercialDocumentHtml(payload, template);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, generateDocumentFileName(payload));
  return payload;
};


const waitForDocumentAssets = async (root) => {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      image.onload = resolve;
      image.onerror = resolve;
    });
  }));
};

const createStyledPdfFromHtml = async (html) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('PDF export is available only in the browser.');
  }

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = '210mm';
  host.style.background = '#ffffff';
  host.style.zIndex = '-1';
  host.innerHTML = html;
  document.body.appendChild(host);

  try {
    await waitForDocumentAssets(host);

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const pageNodes = Array.from(host.querySelectorAll('.page'));
    const renderNodes = pageNodes.length > 0 ? pageNodes : [host.querySelector('main') || host];

    for (let index = 0; index < renderNodes.length; index += 1) {
      const page = renderNodes[index];
      page.style.boxShadow = 'none';
      page.style.margin = '0';

      const canvas = await html2canvas(page, {
        backgroundColor: '#ffffff',
        scale: Math.min(2, window.devicePixelRatio || 1.5),
        useCORS: true,
        logging: false,
        windowWidth: page.scrollWidth,
        windowHeight: page.scrollHeight,
      });
      const imageData = canvas.toDataURL('image/png');
      const naturalHeight = (canvas.height * pageWidth) / canvas.width;

      if (index > 0) pdf.addPage();
      if (renderNodes.length === 1 && naturalHeight > pageHeight * 1.04) {
        let remainingHeight = naturalHeight;
        let y = 0;
        pdf.addImage(imageData, 'PNG', 0, y, pageWidth, naturalHeight, undefined, 'FAST');
        remainingHeight -= pageHeight;
        while (remainingHeight > 0) {
          y -= pageHeight;
          pdf.addPage();
          pdf.addImage(imageData, 'PNG', 0, y, pageWidth, naturalHeight, undefined, 'FAST');
          remainingHeight -= pageHeight;
        }
      } else {
        const scale = naturalHeight > pageHeight ? pageHeight / naturalHeight : 1;
        const drawWidth = pageWidth * scale;
        const drawHeight = naturalHeight * scale;
        pdf.addImage(imageData, 'PNG', (pageWidth - drawWidth) / 2, 0, drawWidth, drawHeight, undefined, 'FAST');
      }
    }

    return pdf;
  } finally {
    host.remove();
  }
};

const makeText = (text, options = {}) => new TextRun({
  text: String(text ?? ''),
  font: 'Arial',
  size: options.size || 22,
  bold: options.bold || false,
  color: options.color || '111827',
});

const makeParagraph = (text, options = {}) => new Paragraph({
  heading: options.heading,
  alignment: options.alignment,
  spacing: options.spacing || { after: 120 },
  children: [makeText(text, options)],
});

const makeCell = (text, options = {}) => new TableCell({
  width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
  shading: options.shading ? { fill: options.shading } : undefined,
  margins: { top: 120, bottom: 120, left: 120, right: 120 },
  children: [
    new Paragraph({
      alignment: options.align || AlignmentType.LEFT,
      children: [makeText(text, {
        bold: options.bold,
        size: options.size || 18,
        color: options.color || '111827',
      })],
    }),
  ],
});

const createTemplateDocxBlob = async (payload, template) => {
  await ensureDocxModule();
  const itemsTableMarker = '[[EKV_ITEMS_TABLE]]';
  const templateContent = String(template.content || '')
    .replace(/\{\{items_table\}\}/g, itemsTableMarker)
    .replace(/\{items_table\}/g, itemsTableMarker);
  const filledContent = stripHtml(fillDocumentTemplate(templateContent, payload));
  const blocks = filledContent.split('\\n').map((line) => line.trim()).filter(Boolean);
  const children = blocks.length > 0
    ? blocks.flatMap((block, index) => {
      if (!block.includes(itemsTableMarker)) {
        return [makeParagraph(block, {
          bold: index === 0,
          size: index === 0 ? 30 : 22,
          spacing: { after: index === 0 ? 220 : 100 },
        })];
      }
      return block.split(itemsTableMarker).flatMap((part, partIndex, parts) => {
        const section = [];
        const cleanPart = part.trim();
        if (cleanPart) {
          section.push(makeParagraph(cleanPart, {
            bold: index === 0 && partIndex === 0,
            size: index === 0 && partIndex === 0 ? 30 : 22,
            spacing: { after: 100 },
          }));
        }
        if (partIndex < parts.length - 1) {
          section.push(createCommercialItemsDocxTable(payload.items || []));
        }
        return section;
      });
    })
    : [makeParagraph(`${payload.document.label} ${payload.document.number}`.trim(), { bold: true, size: 30 })];
  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } },
      },
      children,
    }],
  });

  return Packer.toBlob(doc);
};

export const createCommercialDocumentDocxBlob = async (payload, template = null) => {
  await ensureDocxModule();
  if (template?.content && isPremiumOfferTemplate(template)) {
    return createPremiumOfferDocxBlob(payload);
  }
  if (template?.content) {
    return createTemplateDocxBlob(payload, template);
  }

  const { document, opportunity, items, generatedAt } = payload;
  const totalWithTax = document.totalWithTax ?? (document.total + document.taxTotal);

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('#', { bold: true, shading: 'F3F4F6', width: 6 }),
        makeCell('Kód', { bold: true, shading: 'F3F4F6', width: 12 }),
        makeCell('Název', { bold: true, shading: 'F3F4F6', width: 34 }),
        makeCell('Množství', { bold: true, shading: 'F3F4F6', width: 12, align: AlignmentType.RIGHT }),
        makeCell('Jedn. cena', { bold: true, shading: 'F3F4F6', width: 16, align: AlignmentType.RIGHT }),
        makeCell('Celkem', { bold: true, shading: 'F3F4F6', width: 20, align: AlignmentType.RIGHT }),
      ],
    }),
    ...(items.length > 0 ? items.map((item) => new TableRow({
      children: [
        makeCell(item.position, { width: 6 }),
        makeCell(item.code || '-', { width: 12 }),
        makeCell(item.name, { width: 34 }),
        makeCell(`${Number(item.quantity || 0).toLocaleString('cs-CZ')} ${item.unit}`, { width: 12, align: AlignmentType.RIGHT }),
        makeCell(formatCurrency(item.unitPrice), { width: 16, align: AlignmentType.RIGHT }),
        makeCell(formatCurrency(item.lineTotal), { width: 20, align: AlignmentType.RIGHT }),
      ],
    })) : [
      new TableRow({
        children: [makeCell('Dokument zatím nemá položky.', { width: 100 })],
      }),
    ]),
  ];
  const itemsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
    },
    rows,
  });

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 },
        },
      },
      children: [
        new Paragraph({
          spacing: { after: 120 },
          children: [
            makeText('EKV Group', { bold: true, size: 34 }),
            makeText(`    ${document.label}`, { bold: true, size: 30 }),
          ],
        }),
        makeParagraph(document.number || 'Bez čísla', { color: '6B7280' }),
        makeParagraph(document.title, { heading: HeadingLevel.HEADING_1, size: 30, bold: true }),
        makeParagraph(`Klient: ${opportunity.subjectName || 'Bez subjektu'}`),
        makeParagraph(`Projekt: ${opportunity.projectName || opportunity.projectCode || '-'}`),
        makeParagraph(`Datum: ${formatDate(document.issueDate)}    Platnost: ${formatDate(document.validUntil)}`),
        makeParagraph('Položky', { heading: HeadingLevel.HEADING_2, bold: true, size: 26, spacing: { before: 240, after: 120 } }),
        itemsTable,
        makeParagraph(`Mezisoučet: ${formatCurrency(document.subtotal)}`, { alignment: AlignmentType.RIGHT, spacing: { before: 240, after: 60 } }),
        makeParagraph(`Sleva: ${formatCurrency(document.discountTotal)}`, { alignment: AlignmentType.RIGHT, spacing: { after: 60 } }),
        makeParagraph(`DPH: ${formatCurrency(document.taxTotal)}`, { alignment: AlignmentType.RIGHT, spacing: { after: 60 } }),
        makeParagraph(`Celkem s DPH: ${formatCurrency(totalWithTax)}`, { alignment: AlignmentType.RIGHT, bold: true, size: 26 }),
        ...(document.notes ? [
          makeParagraph('Poznámka', { heading: HeadingLevel.HEADING_2, bold: true, size: 24, spacing: { before: 240, after: 80 } }),
          makeParagraph(document.notes),
        ] : []),
        makeParagraph(`Vygenerováno: ${formatDate(generatedAt)}`, { color: '6B7280', size: 18, spacing: { before: 360 } }),
      ],
    }],
  });

  return Packer.toBlob(doc);
};

export const downloadGeneratedDocumentDocx = async ({ opportunity, document, template }) => {
  const payload = buildDocumentGenerationPayload({ opportunity, document });
  const blob = await createCommercialDocumentDocxBlob(payload, template);
  downloadBlob(blob, generateDocumentFileName(payload, 'docx'));
  return payload;
};

export const createCommercialDocumentPdf = async (payload, template = null) => {
  const html = renderCommercialDocumentHtml(payload, template);
  return createStyledPdfFromHtml(html);
};
export const downloadGeneratedDocumentPdf = async ({ opportunity, document, template }) => {
  const payload = buildDocumentGenerationPayload({ opportunity, document });
  const pdf = await createCommercialDocumentPdf(payload, template);
  pdf.save(generateDocumentFileName(payload, 'pdf'));
  return payload;
};

const buildOpportunityOverviewPayload = (opportunity, documents = []) => {
  const generatedAt = new Date().toISOString();
  const items = [...(opportunity?.items || [])]
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((item, index) => ({
      position: index + 1,
      code: item.code || '',
      name: item.name || '',
      quantity: Number(item.quantity || 0),
      unit: item.unit || 'ks',
      unitPrice: Number(item.unit_price || 0),
      discountPercent: Number(item.discount_percent || 0),
      vatRate: Number(item.vat_rate || 0),
      lineTotal: Number(item.line_total || 0),
    }));

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const taxTotal = items.reduce((sum, item) => sum + (item.lineTotal * (item.vatRate / 100)), 0);

  return {
    opportunity: {
      id: opportunity?.id,
      number: opportunity?.number || '',
      title: opportunity?.title || 'Obchodní případ',
      subjectName: opportunity?.subject?.name || '',
      projectName: opportunity?.project?.name || '',
      projectCode: opportunity?.project?.code || '',
      stage: opportunity?.stage || '',
      priority: opportunity?.priority || '',
      probability: Number(opportunity?.probability || 0),
      value: Number(opportunity?.value || 0),
      expectedCloseDate: opportunity?.expected_close_date || null,
      nextStep: opportunity?.next_step || '',
      description: opportunity?.description || '',
      originalId: buildOriginalDocumentId({
        type: 'opportunity_overview',
        number: opportunity?.number || '',
        id: opportunity?.id,
        title: opportunity?.title,
        issueDate: opportunity?.created_at,
        generatedAt,
      }),
    },
    items,
    documents: [...documents].sort((a, b) => String(a.type || '').localeCompare(String(b.type || ''))),
    totals: {
      subtotal,
      taxTotal,
      totalWithTax: subtotal + taxTotal,
      value: Number(opportunity?.value || subtotal || 0),
    },
    generatedAt,
  };
};

const generateOpportunityOverviewFileName = (payload, extension = 'html') => {
  const parts = ['OP', payload.opportunity.number, payload.opportunity.title, payload.opportunity.subjectName].filter(Boolean);
  return `${sanitizeFileName(parts.join(' '))}.${extension}`;
};

const renderOpportunityOverviewHtml = (payload) => {
  const { opportunity, items, documents, totals, generatedAt } = payload;
  const documentRows = documents.length > 0 ? documents.map((document) => `
    <tr>
      <td>${escapeHtml(document.type === 'order' ? 'Objednávka' : 'Nabídka')}</td>
      <td>${escapeHtml(document.number || '-')}</td>
      <td>${escapeHtml(document.title || '-')}</td>
      <td>${escapeHtml(document.status || '-')}</td>
      <td class="num">${formatCurrency(document.total || 0)}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="empty">Zatím bez nabídek a objednávek.</td></tr>';

  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opportunity.number || 'OP')} ${escapeHtml(opportunity.title)}</title>
  <style>
    body { margin: 0; background: #f3f4f6; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.45; }
    .page { width: 210mm; min-height: 297mm; margin: 16px auto; background: #fff; padding: 18mm; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12); }
    header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 18px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 28px; line-height: 1.15; }
    h2 { margin: 26px 0 10px; font-size: 15px; }
    .muted { color: #6b7280; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
    .box span { display: block; color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .box strong { display: block; margin-top: 4px; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { background: #f9fafb; color: #6b7280; font-size: 11px; text-align: left; text-transform: uppercase; border-bottom: 1px solid #e5e7eb; padding: 8px; }
    td { border-bottom: 1px solid #eef2f7; padding: 8px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .empty { text-align: center; color: #6b7280; padding: 20px; }
    .notes { white-space: pre-wrap; color: #374151; }
    footer { margin-top: 34px; color: #6b7280; font-size: 11px; border-top: 1px solid #e5e7eb; padding-top: 10px; }
    @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; width: auto; min-height: auto; } }
  </style>
</head>
<body>
  <main class="page">
    <header>
      <div>
        <p class="muted">Obchodní případ ${escapeHtml(opportunity.number || '')}</p>
        <h1>${escapeHtml(opportunity.title)}</h1>
        <p class="muted">${escapeHtml(opportunity.subjectName || 'Bez subjektu')}</p>
      </div>
      <div class="num">
        <strong>EKV Group</strong><br />
        <span class="muted">CRM overview</span><br />
        <span class="muted"><strong>ID originálu:</strong> ${escapeHtml(opportunity.originalId)}</span>
      </div>
    </header>
    <section class="grid">
      <div class="box"><span>Stav</span><strong>${escapeHtml(opportunity.stage || '-')}</strong></div>
      <div class="box"><span>Priorita</span><strong>${escapeHtml(opportunity.priority || '-')}</strong></div>
      <div class="box"><span>Pravděpodobnost</span><strong>${opportunity.probability.toLocaleString('cs-CZ')} %</strong></div>
      <div class="box"><span>Odhad uzavření</span><strong>${formatDate(opportunity.expectedCloseDate)}</strong></div>
      <div class="box"><span>Hodnota</span><strong>${formatCurrency(totals.value)}</strong></div>
      <div class="box"><span>Celkem s DPH z položek</span><strong>${formatCurrency(totals.totalWithTax)}</strong></div>
    </section>
    <h2>Popis</h2>
    <p class="notes">${escapeHtml(opportunity.description || 'Bez popisu.')}</p>
    <h2>Produkty</h2>
    ${renderItemsTableHtml(items)}
    <h2>Nabídky a objednávky</h2>
    <table>
      <thead><tr><th>Typ</th><th>Číslo</th><th>Název</th><th>Stav</th><th class="num">Částka</th></tr></thead>
      <tbody>${documentRows}</tbody>
    </table>
    <h2>Další krok</h2>
    <p class="notes">${escapeHtml(opportunity.nextStep || 'Není naplánován.')}</p>
    <footer>Vygenerováno: ${formatDate(generatedAt)} | ID originálu: ${escapeHtml(opportunity.originalId)}</footer>
  </main>
</body>
</html>`;
};

export const downloadOpportunityOverviewHtml = ({ opportunity, documents = [] }) => {
  const payload = buildOpportunityOverviewPayload(opportunity, documents);
  const blob = new Blob([renderOpportunityOverviewHtml(payload)], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, generateOpportunityOverviewFileName(payload));
  return payload;
};

export const downloadOpportunityOverviewDocx = async ({ opportunity, documents = [] }) => {
  await ensureDocxModule();
  const payload = buildOpportunityOverviewPayload(opportunity, documents);
  const { opportunity: deal, items, totals } = payload;
  const docRows = documents.length > 0 ? documents.map((document) => new TableRow({
    children: [
      makeCell(document.type === 'order' ? 'Objednávka' : 'Nabídka', { width: 18 }),
      makeCell(document.number || '-', { width: 18 }),
      makeCell(document.title || '-', { width: 36 }),
      makeCell(document.status || '-', { width: 14 }),
      makeCell(formatCurrency(document.total || 0), { width: 14, align: AlignmentType.RIGHT }),
    ],
  })) : [new TableRow({ children: [makeCell('Zatím bez nabídek a objednávek.', { width: 100 })] })];

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
      children: [
        makeParagraph(`Obchodní případ ${deal.number || ''}`.trim(), { color: '6B7280' }),
        makeParagraph(deal.title, { heading: HeadingLevel.HEADING_1, bold: true, size: 32 }),
        makeParagraph(`Klient: ${deal.subjectName || 'Bez subjektu'}`),
        makeParagraph(`Stav: ${deal.stage || '-'}    Priorita: ${deal.priority || '-'}    Pravděpodobnost: ${deal.probability} %`),
        makeParagraph(`Hodnota: ${formatCurrency(totals.value)}    Odhad uzavření: ${formatDate(deal.expectedCloseDate)}`),
        makeParagraph('Popis', { heading: HeadingLevel.HEADING_2, bold: true, size: 24, spacing: { before: 240, after: 80 } }),
        makeParagraph(deal.description || 'Bez popisu.'),
        makeParagraph('Produkty', { heading: HeadingLevel.HEADING_2, bold: true, size: 24, spacing: { before: 240, after: 80 } }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                makeCell('#', { bold: true, shading: 'F3F4F6', width: 6 }),
                makeCell('Kód', { bold: true, shading: 'F3F4F6', width: 14 }),
                makeCell('Název', { bold: true, shading: 'F3F4F6', width: 42 }),
                makeCell('Množství', { bold: true, shading: 'F3F4F6', width: 16, align: AlignmentType.RIGHT }),
                makeCell('Celkem', { bold: true, shading: 'F3F4F6', width: 22, align: AlignmentType.RIGHT }),
              ],
            }),
            ...(items.length > 0 ? items.map((item) => new TableRow({
              children: [
                makeCell(item.position, { width: 6 }),
                makeCell(item.code || '-', { width: 14 }),
                makeCell(item.name, { width: 42 }),
                makeCell(`${Number(item.quantity || 0).toLocaleString('cs-CZ')} ${item.unit}`, { width: 16, align: AlignmentType.RIGHT }),
                makeCell(formatCurrency(item.lineTotal), { width: 22, align: AlignmentType.RIGHT }),
              ],
            })) : [new TableRow({ children: [makeCell('Obchodní případ zatím nemá položky.', { width: 100 })] })]),
          ],
        }),
        makeParagraph(`Celkem s DPH: ${formatCurrency(totals.totalWithTax)}`, { alignment: AlignmentType.RIGHT, bold: true, size: 24, spacing: { before: 180, after: 160 } }),
        makeParagraph('Nabídky a objednávky', { heading: HeadingLevel.HEADING_2, bold: true, size: 24, spacing: { before: 240, after: 80 } }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                makeCell('Typ', { bold: true, shading: 'F3F4F6', width: 18 }),
                makeCell('Číslo', { bold: true, shading: 'F3F4F6', width: 18 }),
                makeCell('Název', { bold: true, shading: 'F3F4F6', width: 36 }),
                makeCell('Stav', { bold: true, shading: 'F3F4F6', width: 14 }),
                makeCell('Částka', { bold: true, shading: 'F3F4F6', width: 14, align: AlignmentType.RIGHT }),
              ],
            }),
            ...docRows,
          ],
        }),
        makeParagraph('Další krok', { heading: HeadingLevel.HEADING_2, bold: true, size: 24, spacing: { before: 240, after: 80 } }),
        makeParagraph(deal.nextStep || 'Není naplánován.'),
        makeParagraph(`ID originálu: ${deal.originalId}`, { color: '374151', bold: true, size: 18, spacing: { before: 240, after: 80 } }),
        makeParagraph(`Vygenerováno: ${formatDate(payload.generatedAt)}`, { color: '6B7280', size: 18, spacing: { before: 120 } }),
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, generateOpportunityOverviewFileName(payload, 'docx'));
  return payload;
};

export const downloadOpportunityOverviewPdf = async ({ opportunity, documents = [] }) => {
  const { jsPDF } = await import('jspdf');
  const payload = buildOpportunityOverviewPayload(opportunity, documents);
  const { opportunity: deal, items, totals, generatedAt } = payload;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 14;
  let y = 16;
  const addText = (text, x, lineY, options = {}) => {
    pdf.setFont('helvetica', options.bold ? 'bold' : 'normal');
    pdf.setFontSize(options.size || 10);
    pdf.text(String(text ?? ''), x, lineY, options);
  };

  addText(`Obchodní případ ${deal.number || ''}`.trim(), margin, y, { size: 10 });
  y += 8;
  addText(deal.title, margin, y, { bold: true, size: 17 });
  y += 8;
  addText(`Klient: ${deal.subjectName || 'Bez subjektu'}`, margin, y);
  y += 6;
  addText(`Stav: ${deal.stage || '-'} | Priorita: ${deal.priority || '-'} | Pravděpodobnost: ${deal.probability} %`, margin, y);
  y += 6;
  addText(`Hodnota: ${formatCurrency(totals.value)} | Odhad uzavření: ${formatDate(deal.expectedCloseDate)}`, margin, y);
  y += 10;
  addText('Popis', margin, y, { bold: true, size: 12 });
  y += 6;
  pdf.splitTextToSize(deal.description || 'Bez popisu.', pageWidth - (margin * 2)).forEach((line) => {
    addText(line, margin, y);
    y += 5;
  });
  y += 5;
  addText('Produkty', margin, y, { bold: true, size: 12 });
  y += 7;
  items.forEach((item) => {
    if (y > 270) {
      pdf.addPage();
      y = 16;
    }
    addText(`${item.position}. ${item.code || '-'} ${item.name}`, margin, y, { size: 8 });
    addText(formatCurrency(item.lineTotal), pageWidth - margin, y, { size: 8, align: 'right' });
    y += 5;
  });
  if (items.length === 0) {
    addText('Obchodní případ zatím nemá položky.', margin, y);
    y += 6;
  }
  y += 4;
  addText(`Celkem s DPH: ${formatCurrency(totals.totalWithTax)}`, pageWidth - margin, y, { bold: true, align: 'right' });
  y += 12;
  addText('Nabídky a objednávky', margin, y, { bold: true, size: 12 });
  y += 7;
  if (documents.length === 0) {
    addText('Zatím bez nabídek a objednávek.', margin, y);
    y += 6;
  } else {
    documents.forEach((document) => {
      if (y > 270) {
        pdf.addPage();
        y = 16;
      }
      addText(`${document.type === 'order' ? 'OBJ' : 'NAB'} ${document.number || '-'} - ${document.title || '-'}`, margin, y, { size: 8 });
      addText(formatCurrency(document.total || 0), pageWidth - margin, y, { size: 8, align: 'right' });
      y += 5;
    });
  }
  addText(`Vygenerováno: ${formatDate(generatedAt)}`, margin, 287, { size: 8 });
  pdf.save(generateOpportunityOverviewFileName(payload, 'pdf'));
  return payload;
};

const normalizeHandoverItems = (items = []) => [...items]
  .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
  .map((item, index) => ({
    position: index + 1,
    code: item.code || '',
    name: item.name || item.title || '',
    description: item.description || item.condition_note || '',
    quantity: Number(item.quantity || 0),
    unit: item.unit || 'ks',
    condition: item.condition || '',
    note: item.condition_note || item.description || '',
  }));

const normalizeHandoverDefects = (defects = []) => [...defects]
  .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
  .map((defect, index) => ({
    position: index + 1,
    title: defect.title || '',
    description: defect.description || '',
    severity: defect.severity || 'normal',
    status: defect.status || 'open',
    responsible: defect.responsible || '',
    dueDate: defect.due_date || null,
  }));

const renderHandoverItemsTableHtml = (items) => {
  const rows = items.length ? items.map((item) => `
    <tr>
      <td>${item.position}</td>
      <td>${escapeHtml(item.code || '-')}</td>
      <td><strong>${escapeHtml(item.name || '-')}</strong>${item.description ? `<div class="muted">${escapeHtml(item.description)}</div>` : ''}</td>
      <td class="num">${Number(item.quantity || 0).toLocaleString('cs-CZ')} ${escapeHtml(item.unit)}</td>
      <td>${escapeHtml(item.condition || '-')}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="empty">Zatím nejsou zadány předávané části.</td></tr>';
  return `<table><thead><tr><th>#</th><th>Kód</th><th>Položka / část</th><th class="num">Množství</th><th>Stav</th></tr></thead><tbody>${rows}</tbody></table>`;
};

const renderDefectsTableHtml = (defects) => {
  const rows = defects.length ? defects.map((defect) => `
    <tr>
      <td>${defect.position}</td>
      <td><strong>${escapeHtml(defect.title || '-')}</strong>${defect.description ? `<div class="muted">${escapeHtml(defect.description)}</div>` : ''}</td>
      <td>${escapeHtml(defect.severity)}</td>
      <td>${escapeHtml(defect.status)}</td>
      <td>${escapeHtml(defect.responsible || '-')}</td>
      <td>${formatDate(defect.dueDate)}</td>
    </tr>
  `).join('') : '<tr><td colspan="6" class="empty">Bez vad a nedodělků.</td></tr>';
  return `<table><thead><tr><th>#</th><th>Vada / nedodělek</th><th>Závažnost</th><th>Stav</th><th>Odpovědný</th><th>Termín</th></tr></thead><tbody>${rows}</tbody></table>`;
};

const renderSignaturesTableHtml = (signatures = []) => {
  const rows = signatures.length ? signatures.map((signature, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(signature.signer_name || '-')}</td>
      <td>${escapeHtml(signature.signer_role || '-')}</td>
      <td>${escapeHtml(signature.signer_email || '-')}</td>
      <td>${formatDate(signature.signed_at)}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="empty">Dokument zatím není podepsaný.</td></tr>';
  return `<table><thead><tr><th>#</th><th>Jméno</th><th>Role</th><th>Email</th><th>Čas podpisu</th></tr></thead><tbody>${rows}</tbody></table>`;
};

const buildDefectTemplatePlaceholders = (defect) => ({
  defect_position: defect.position,
  defect_title: defect.title || '',
  defect_description: defect.description || '',
  defect_severity: defect.severity || '',
  defect_status: defect.status || '',
  defect_responsible: defect.responsible || '',
  defect_due_date: formatDate(defect.dueDate),
});

const fillDefectRepeatBlocks = (templateContent, defects) => {
  const replaceBlock = (content, opening, closing) => {
    const blockRegex = new RegExp(`${escapeRegExp(opening)}([\\s\\S]*?)${escapeRegExp(closing)}`, 'g');
    return content.replace(blockRegex, (_, rowTemplate) => (
      defects.map((defect) => replaceTemplatePlaceholders(rowTemplate, buildDefectTemplatePlaceholders(defect))).join('')
    ));
  };
  return replaceBlock(replaceBlock(String(templateContent || ''), '{{#defects}}', '{{/defects}}'), '{#defects}', '{/defects}');
};

export const buildHandoverProtocolPayload = ({ protocol }) => {
  const items = normalizeHandoverItems(protocol?.items || []);
  const defects = normalizeHandoverDefects(protocol?.defects || []);
  const project = protocol?.project || {};
  const realization = protocol?.realization || {};
  const opportunity = protocol?.opportunity || {};
  const subject = protocol?.subject || {};
  const generatedAt = new Date().toISOString();
  const documentType = protocol?.document_type || 'handover_full';
  const documentNumber = protocol?.number || '';
  return {
    document: {
      id: protocol?.id,
      type: documentType,
      label: documentTypeLabels[documentType] || 'Dokument',
      number: documentNumber,
      originalId: buildOriginalDocumentId({
        type: documentType,
        number: documentNumber,
        id: protocol?.id,
        title: protocol?.title,
        issueDate: protocol?.document_date || protocol?.created_at,
        version: protocol?.version || 1,
        generatedAt,
      }),
      title: protocol?.title || 'Předávací dokument',
      status: protocol?.status || 'draft',
      issueDate: protocol?.document_date || protocol?.created_at || new Date().toISOString(),
      notes: protocol?.notes || '',
      scope: protocol?.handover_scope || '',
      serviceDescription: protocol?.service_description || '',
      version: protocol?.version || 1,
      lockedAt: protocol?.locked_at || null,
    },
    project: {
      id: project?.id || protocol?.project_id,
      name: project?.name || '',
      code: project?.code || '',
    },
    realization: {
      id: realization?.id || protocol?.realizace_id,
      name: realization?.name || '',
      status: realization?.status || '',
    },
    opportunity: {
      id: opportunity?.id || protocol?.opportunity_id,
      number: opportunity?.number || '',
      title: opportunity?.title || '',
    },
    client: {
      id: subject?.id || protocol?.subject_id,
      name: subject?.name || protocol?.client_name || '',
      email: subject?.email || '',
      phone: subject?.phone || '',
      ico: subject?.ico || '',
      dic: subject?.dic || '',
    },
    items,
    defects,
    signatures: protocol?.signatures || [],
    generatedAt,
  };
};

const buildHandoverPlaceholders = (payload) => ({
  document_number: payload.document.number || '',
  document_title: payload.document.title || '',
  document_type: payload.document.label || '',
  document_original_id: payload.document.originalId || '',
  document_date: formatDate(payload.document.issueDate),
  document_status: payload.document.status || '',
  client_name: payload.client.name || 'Bez subjektu',
  client_email: payload.client.email || '',
  client_phone: payload.client.phone || '',
  client_ico: payload.client.ico || '',
  client_dic: payload.client.dic || '',
  project_name: payload.project.name || '',
  project_code: payload.project.code || '',
  realization_name: payload.realization.name || '',
  realization_status: payload.realization.status || '',
  opportunity_number: payload.opportunity.number || '',
  opportunity_title: payload.opportunity.title || '',
  handover_scope: payload.document.scope || '',
  service_description: payload.document.serviceDescription || '',
  notes: payload.document.notes || '',
  items_table: renderHandoverItemsTableHtml(payload.items),
  defects_table: renderDefectsTableHtml(payload.defects),
  signatures_table: renderSignaturesTableHtml(payload.signatures),
  generated_at: formatDate(payload.generatedAt),
});

export const fillHandoverTemplate = (templateContent, payload) => {
  const cleanTemplate = sanitizeDocumentTemplateHtml(templateContent);
  const withItems = fillItemsRepeatBlocks(cleanTemplate, payload.items.map((item) => ({
    ...item,
    unitPrice: 0,
    discountPercent: 0,
    vatRate: 0,
    lineTotal: 0,
    customFields: {},
  })));
  const withDefects = fillDefectRepeatBlocks(withItems, payload.defects);
  return sanitizeGeneratedDocumentHtml(replaceTemplatePlaceholders(withDefects, buildHandoverPlaceholders(payload)));
};

export const renderHandoverProtocolHtml = (payload, template = null) => {
  if (template?.content) {
    return sanitizeGeneratedDocumentHtml(ensureHtmlDocument(
      fillHandoverTemplate(template.content, payload),
      `${payload.document.label} ${payload.document.number || ''}`.trim()
    ));
  }
  return sanitizeGeneratedDocumentHtml(`<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(payload.document.label)} ${escapeHtml(payload.document.number)}</title>
  <style>
    :root { color-scheme: light; --ink:#0f172a; --muted:#64748b; --line:#dbe3ef; --soft:#f7f9fc; --blue:#1d4ed8; --green:#047857; }
    * { box-sizing: border-box; }
    body { margin:0; background:#e9edf4; color:var(--ink); font-family:"Segoe UI", Calibri, Arial, sans-serif; font-size:12.5px; line-height:1.48; }
    .page { width:210mm; min-height:297mm; margin:18px auto; background:#fff; padding:16mm; box-shadow:0 20px 50px rgba(15,23,42,.16); }
    .topline { height:6px; border-radius:999px; background:linear-gradient(90deg,var(--blue),#22c55e); margin-bottom:18px; }
    header { display:grid; grid-template-columns:minmax(0,1fr) 66mm; gap:18px; align-items:start; padding-bottom:16px; border-bottom:1px solid var(--line); }
        .brand-lockup { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
    .brand-logo { width:158px; max-width:48mm; height:auto; display:block; }
    .brand-copy strong { display:block; font-size:14px; }
    .brand-copy span { display:block; color:var(--muted); font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; margin-top:2px; }
    .eyebrow { margin:0 0 6px; color:var(--blue); font-size:10.5px; font-weight:800; letter-spacing:.11em; text-transform:uppercase; }
    h1 { margin:0; font-size:25px; line-height:1.12; letter-spacing:-.01em; }
    h2 { margin:0 0 9px; font-size:13px; letter-spacing:.02em; }
    .subtitle { margin:7px 0 0; color:var(--muted); font-size:12px; }
    .doc-meta { border:1px solid var(--line); border-radius:10px; overflow:hidden; }
    .doc-meta div { display:grid; grid-template-columns:22mm minmax(0,1fr); gap:10px; padding:8px 10px; border-bottom:1px solid #eef2f7; align-items:start; }
    .doc-meta div:last-child { border-bottom:0; }
    .doc-meta span { color:var(--muted); }
    .doc-meta strong { text-align:right; overflow-wrap:anywhere; line-height:1.25; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:18px 0; }
    .box { border:1px solid var(--line); border-radius:10px; padding:12px; background:linear-gradient(180deg,#fff,#fbfcff); }
    .box-title { margin:0 0 8px; color:var(--muted); font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.09em; }
    .box strong { font-size:14px; }
    .muted { color:var(--muted); }
    .section { margin-top:18px; break-inside:avoid; }
    .notes { margin:0; white-space:pre-wrap; color:#334155; }
    table { width:100%; border-collapse:separate; border-spacing:0; margin-top:8px; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
    th { background:#f1f5f9; color:#475569; font-size:10.5px; text-align:left; text-transform:uppercase; letter-spacing:.06em; padding:8px 9px; border-bottom:1px solid var(--line); }
    td { padding:8px 9px; border-bottom:1px solid #eef2f7; vertical-align:top; }
    tr:last-child td { border-bottom:0; }
    tbody tr:nth-child(even) td { background:#fbfdff; }
    .num { text-align:right; white-space:nowrap; }
    .empty { text-align:center; color:var(--muted); padding:22px; }
    .sign-row { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:22px; }
    .sign-box { min-height:72px; border:1px dashed #b6c2d2; border-radius:10px; padding:10px; color:var(--muted); }
    .signature-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:12px; }
    .signature-card { min-height:92px; border:1px dashed #9aa8bc; border-radius:12px; padding:12px; background:#fbfdff; display:flex; flex-direction:column; justify-content:space-between; }
    .signature-line { border-top:1px solid #64748b; padding-top:7px; color:var(--muted); font-size:10.5px; }
    .signature-role { color:var(--muted); font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; }
    footer { margin-top:26px; padding-top:10px; border-top:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; color:var(--muted); font-size:10.5px; }
    @media print { body{background:#fff}.page{margin:0;box-shadow:none;width:auto;min-height:auto}.topline{border-radius:0} }
  </style>
</head>
<body>
  <main class="page">
    <div class="topline"></div>
    <header>
      <div>
        <div class="brand-lockup"><img class="brand-logo" src="${ekvProjectLogoDataUri}" alt="EKV Project" /></div>
        <p class="eyebrow">${escapeHtml(payload.document.number || 'Bez čísla')}</p>
        <h1>${escapeHtml(payload.document.label)}</h1>
        <p class="subtitle">${escapeHtml(payload.document.title)}</p>
      </div>
      <div class="doc-meta">
        <div><span>Vystavil</span><strong>EKV Group</strong></div>
        <div><span>Datum</span><strong>${formatDate(payload.document.issueDate)}</strong></div>
        <div><span>Stav</span><strong>${escapeHtml(payload.document.status || '-')}</strong></div>
              <div><span>ID originálu</span><strong>${escapeHtml(payload.document.originalId)}</strong></div>
      </div>
    </header>

    <section class="grid">
      <div class="box">
        <p class="box-title">Klient</p>
        <strong>${escapeHtml(payload.client.name || 'Bez subjektu')}</strong>
        <p class="muted">${escapeHtml([payload.client.email, payload.client.phone].filter(Boolean).join(' | ') || 'Kontakt není vyplněn')}</p>
        ${payload.client.ico || payload.client.dic ? `<p class="muted">${escapeHtml([payload.client.ico ? `IČO ${payload.client.ico}` : '', payload.client.dic ? `DIČ ${payload.client.dic}` : ''].filter(Boolean).join(' | '))}</p>` : ''}
      </div>
      <div class="box">
        <p class="box-title">Projekt / realizace</p>
        <strong>${escapeHtml(payload.project.name || payload.realization.name || '-')}</strong>
        <p class="muted">${escapeHtml([payload.project.code, payload.realization.name || payload.realization.status].filter(Boolean).join(' | ') || 'Bez vazby')}</p>
      </div>
    </section>

    <section class="section">
      <h2>Rozsah předání</h2>
      <p class="notes">${escapeHtml(payload.document.scope || payload.document.serviceDescription || 'Bez popisu.')}</p>
    </section>

    <section class="section">
      <h2>Předané části</h2>
      ${renderHandoverItemsTableHtml(payload.items)}
    </section>

    <section class="section">
      <h2>Vady a nedodělky</h2>
      ${renderDefectsTableHtml(payload.defects)}
    </section>

    <section class="section">
      <h2>Podpisy</h2>
      ${renderSignaturesTableHtml(payload.signatures)}
    </section>

    ${payload.document.notes ? `<section class="section"><h2>Poznámky</h2><p class="notes">${escapeHtml(payload.document.notes)}</p></section>` : ''}

    <section class="section signature-panel">
      <h2>Podpisová doložka</h2>
      <div class="signature-grid">
        <div class="signature-card">
          <div><strong>${escapeHtml(payload.client.name || 'Klient')}</strong><div class="signature-role">Přebírající / klient</div></div>
          <div class="signature-line">Datum a podpis</div>
        </div>
        <div class="signature-card">
          <div><strong>EKV Group</strong><div class="signature-role">Předávající / zhotovitel</div></div>
          <div class="signature-line">Datum a podpis</div>
        </div>
      </div>
    </section>

    <footer>
      <span>Vygenerováno: ${formatDate(payload.generatedAt)}</span>
      <span>ID originálu: ${escapeHtml(payload.document.originalId)}</span>
    </footer>
  </main>
</body>
</html>`);
};

const createHandoverDocxBlob = async (payload, template = null) => {
  await ensureDocxModule();
  const html = template?.content ? fillHandoverTemplate(template.content, payload) : renderHandoverProtocolHtml(payload, null);
  const lines = stripHtml(html).split('\n').map((line) => line.trim()).filter(Boolean);
  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
      children: lines.map((line, index) => makeParagraph(line, { bold: index === 0, size: index === 0 ? 30 : 21, spacing: { after: index === 0 ? 200 : 90 } })),
    }],
  });
  return Packer.toBlob(doc);
};

const createHandoverPdf = async (payload, template = null) => {
  const html = renderHandoverProtocolHtml(payload, template);
  return createStyledPdfFromHtml(html);
};

const generateHandoverFileName = (payload, extension = 'html') => `${sanitizeFileName([payload.document.label, payload.document.number, payload.client.name].filter(Boolean).join(' '))}.${extension}`;

export const downloadHandoverProtocolHtml = ({ protocol, template }) => {
  const payload = buildHandoverProtocolPayload({ protocol });
  const blob = new Blob([renderHandoverProtocolHtml(payload, template)], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, generateHandoverFileName(payload, 'html'));
  return payload;
};

export const downloadHandoverProtocolDocx = async ({ protocol, template }) => {
  const payload = buildHandoverProtocolPayload({ protocol });
  const blob = await createHandoverDocxBlob(payload, template);
  downloadBlob(blob, generateHandoverFileName(payload, 'docx'));
  return payload;
};

export const downloadHandoverProtocolPdf = async ({ protocol, template }) => {
  const payload = buildHandoverProtocolPayload({ protocol });
  const pdf = await createHandoverPdf(payload, template);
  pdf.save(generateHandoverFileName(payload, 'pdf'));
  return payload;
};

export const createHandoverProtocolPdfBlob = async ({ protocol, template }) => {
  const payload = buildHandoverProtocolPayload({ protocol });
  const pdf = await createHandoverPdf(payload, template);
  return {
    blob: pdf.output('blob'),
    payload,
    fileName: generateHandoverFileName(payload, 'pdf'),
  };
};

export const documentGenerationTargets = [
  { type: 'offer', label: 'Nabídky', output: ['html', 'docx', 'pdf'] },
  { type: 'order', label: 'Objednávky', output: ['html', 'docx', 'pdf'] },
  { type: 'contract', label: 'Smlouvy', output: ['html', 'pdf', 'docx'] },
  { type: 'handover_full', label: 'Celkový předávací protokoly', output: ['html', 'pdf', 'docx'] },
  { type: 'handover_partial', label: 'Částečný předávací protokoly', output: ['html', 'pdf', 'docx'] },
  { type: 'service_protocol', label: 'Servisní protokoly', output: ['html', 'pdf', 'docx'] },
];
